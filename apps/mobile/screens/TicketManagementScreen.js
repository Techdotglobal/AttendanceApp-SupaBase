import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  TextInput,
  FlatList,
  RefreshControl,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getTicketById,
  updateTicketStatus,
  assignTicket,
  addTicketResponse,
  getStatusLabel,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
  getCategoryLabel,
  TICKET_STATUS,
} from '../utils/ticketManagement';
import { getAdminUsers } from '../utils/employees';
import { useTheme } from '../contexts/ThemeContext';
import { isTablet } from '../shared/utils/responsive';

export default function TicketManagementScreen({ navigation, route }) {
  const { user, ticket: initialTicket } = route.params;
  const { colors } = useTheme();
  const tablet = isTablet();
  const [ticket, setTicket] = useState(initialTicket);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [employees, setEmployees] = useState([]);
  
  // Modals
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  
  // Form state
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [responseMessage, setResponseMessage] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(ticket?.status || TICKET_STATUS.OPEN);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
    
    // Safely check if navigation and addListener exist
    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('focus', () => {
          loadTicket();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[TicketManagementScreen] Failed to add navigation listener:', error);
        }
      }
    }
    
    return () => {
      // Only call unsubscribe if it's a function
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          if (__DEV__) {
            console.warn('[TicketManagementScreen] Error unsubscribing navigation listener:', error);
          }
        }
      }
    };
  }, [navigation]);

  const loadData = async () => {
    await Promise.all([
      loadTicket(),
      loadEmployees()
    ]);
  };

  const loadTicket = async () => {
    if (ticket?.id) {
      try {
        const updatedTicket = await getTicketById(ticket.id);
        if (updatedTicket) {
          setTicket(updatedTicket);
          setSelectedStatus(updatedTicket.status);
        }
      } catch (error) {
        console.error('Error loading ticket:', error);
      }
    }
  };

  const loadEmployees = async () => {
    try {
      // Fetch all managers and super_admins from Supabase
      const admins = await getAdminUsers(user.companyId);
      setEmployees(admins);
      console.log(`[TicketManagement] Loaded ${admins.length} eligible assignees (managers + super_admins)`);
    } catch (error) {
      console.error('Error loading employees:', error);
      Alert.alert('Error', 'Failed to load assignees. Please try again.');
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadTicket();
    setIsRefreshing(false);
  };

  const handleAssignTicket = async () => {
    if (!selectedEmployee) {
      Alert.alert('Error', 'Please select an employee to assign');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await assignTicket(ticket.id, selectedEmployee.username, user.username);
      if (result.success) {
        Alert.alert('Success', 'Ticket assigned successfully');
        setShowAssignModal(false);
        setSelectedEmployee(null);
        
        // Update local state immediately with returned data if available
        if (result.data) {
          setTicket(result.data);
        }
        
        // Reload ticket from Supabase to ensure consistency
        await loadTicket();
      } else {
        Alert.alert('Error', result.error || 'Failed to assign ticket');
      }
    } catch (error) {
      console.error('Error assigning ticket:', error);
      Alert.alert('Error', 'Failed to assign ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async () => {
    setIsSubmitting(true);
    try {
      const result = await updateTicketStatus(ticket.id, selectedStatus, user.username);
      if (result.success) {
        Alert.alert('Success', 'Ticket status updated successfully');
        setShowStatusModal(false);
        await loadTicket();
      } else {
        Alert.alert('Error', result.error || 'Failed to update status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddResponse = async () => {
    if (!responseMessage.trim()) {
      Alert.alert('Error', 'Please enter a response message');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await addTicketResponse(ticket.id, user.username, responseMessage);
      if (result.success) {
        Alert.alert('Success', 'Response added successfully');
        setShowResponseModal(false);
        setResponseMessage('');
        await loadTicket();
      } else {
        Alert.alert('Error', result.error || 'Failed to add response');
      }
    } catch (error) {
      console.error('Error adding response:', error);
      Alert.alert('Error', 'Failed to add response');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!ticket) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <Text style={{ color: colors.text }}>Loading ticket...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <View style={{ padding: 16 }}>
          {/* Ticket Header */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: 20,
              marginBottom: 16,
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: 'bold',
                    color: colors.text,
                    marginBottom: 8,
                  }}
                >
                  {ticket.subject}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.textTertiary,
                  }}
                >
                  Created by {ticket.createdBy} • {formatDate(ticket.createdAt)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View
                  style={{
                    backgroundColor: getStatusColor(ticket.status) + '20',
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    marginBottom: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: getStatusColor(ticket.status),
                    }}
                  >
                    {getStatusLabel(ticket.status)}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: getPriorityColor(ticket.priority) + '20',
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: getPriorityColor(ticket.priority),
                    }}
                  >
                    {getPriorityLabel(ticket.priority)}
                  </Text>
                </View>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name="pricetag-outline" size={16} color={colors.textSecondary} />
              <Text style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 6 }}>
                {getCategoryLabel(ticket.category)}
              </Text>
              {ticket.assignedTo && (
                <>
                  <Text style={{ color: colors.textTertiary, marginHorizontal: 8 }}>•</Text>
                  <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                  <Text style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 6 }}>
                    Assigned to {ticket.assignedTo}
                  </Text>
                </>
              )}
            </View>

            <Text
              style={{
                fontSize: 14,
                color: colors.text,
                lineHeight: 20,
              }}
            >
              {ticket.description}
            </Text>
          </View>

          {/* Actions */}
          <View style={{ gap: 12, marginBottom: 16 }}>
            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 16,
                flexDirection: 'row',
                alignItems: 'center',
              }}
              onPress={() => setShowStatusModal(true)}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.primaryLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 }}>
                Update Status
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 16,
                flexDirection: 'row',
                alignItems: 'center',
              }}
              onPress={() => setShowAssignModal(true)}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: '#10b98120',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Ionicons name="person-add-outline" size={20} color="#10b981" />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 }}>
                {ticket.assignedTo ? 'Reassign Ticket' : 'Assign Ticket'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 16,
                flexDirection: 'row',
                alignItems: 'center',
              }}
              onPress={() => setShowResponseModal(true)}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: '#f59e0b20',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Ionicons name="chatbubble-outline" size={20} color="#f59e0b" />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 }}>
                Add Response
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Responses */}
          {ticket.responses && ticket.responses.length > 0 && (
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '600',
                  color: colors.text,
                  marginBottom: 12,
                }}
              >
                Responses ({ticket.responses.length})
              </Text>
              {ticket.responses.map((response) => (
                <View
                  key={response.id}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                      {response.respondedBy}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                      {formatDate(response.createdAt)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                    {response.message}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Assign Modal */}
      <Modal
        visible={showAssignModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAssignModal(false)}
      >
        <View style={{ flex: 1, justifyContent: tablet ? 'center' : 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: tablet ? 24 : 0, borderBottomRightRadius: tablet ? 24 : 0, padding: 24, maxHeight: tablet ? '80%' : '60%', width: '100%', maxWidth: tablet ? 700 : undefined, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: colors.text }}>
                Assign Ticket
              </Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {employees.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                  No managers or super admins available
                </Text>
              </View>
            ) : (
              <FlatList
                data={employees}
                keyExtractor={(item) => item.uid || item.id}
                renderItem={({ item }) => {
                  const roleLabel = item.role === 'super_admin' ? 'Super Admin' : 
                                   item.role === 'manager' ? 'Manager' : item.role;
                  const displayName = item.name || item.username || 'Unknown';
                  const displayPosition = item.position || '';
                  const displayText = displayPosition 
                    ? `${displayName} — ${displayPosition} (${roleLabel})`
                    : `${displayName} (${roleLabel})`;
                  
                  return (
                    <TouchableOpacity
                      style={{
                        backgroundColor: selectedEmployee?.uid === item.uid || selectedEmployee?.id === item.id 
                          ? colors.primaryLight 
                          : colors.background,
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                      onPress={() => setSelectedEmployee(item)}
                    >
                      <Ionicons
                        name={selectedEmployee?.uid === item.uid || selectedEmployee?.id === item.id 
                          ? 'radio-button-on' 
                          : 'radio-button-off'}
                        size={20}
                        color={selectedEmployee?.uid === item.uid || selectedEmployee?.id === item.id 
                          ? colors.primary 
                          : colors.textSecondary}
                      />
                      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                        <Text numberOfLines={2} ellipsizeMode="tail" style={{ fontSize: 16, color: colors.text, fontWeight: '500' }}>
                          {displayText}
                        </Text>
                        {item.department && (
                          <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                            {item.department}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={{ backgroundColor: colors.border, borderRadius: 8, padding: 12, flex: 1 }}
                onPress={() => setShowAssignModal(false)}
              >
                <Text style={{ textAlign: 'center', fontWeight: '500', color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 12, flex: 1 }}
                onPress={handleAssignTicket}
                disabled={isSubmitting || !selectedEmployee}
              >
                <Text style={{ textAlign: 'center', fontWeight: '500', color: 'white' }}>
                  {isSubmitting ? 'Assigning...' : 'Assign'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Response Modal */}
      <Modal
        visible={showResponseModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowResponseModal(false)}
      >
        <View style={{ flex: 1, justifyContent: tablet ? 'center' : 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: tablet ? 24 : 0, borderBottomRightRadius: tablet ? 24 : 0, padding: 24, width: '100%', maxWidth: tablet ? 700 : undefined, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: colors.text }}>Add Response</Text>
              <TouchableOpacity onPress={() => setShowResponseModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                color: colors.text,
                minHeight: 100,
                textAlignVertical: 'top',
                marginBottom: 16,
              }}
              placeholder="Enter your response..."
              placeholderTextColor={colors.textTertiary}
              value={responseMessage}
              onChangeText={setResponseMessage}
              multiline
              numberOfLines={5}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{ backgroundColor: colors.border, borderRadius: 8, padding: 12, flex: 1 }}
                onPress={() => setShowResponseModal(false)}
              >
                <Text style={{ textAlign: 'center', fontWeight: '500', color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 12, flex: 1 }}
                onPress={handleAddResponse}
                disabled={isSubmitting || !responseMessage.trim()}
              >
                <Text style={{ textAlign: 'center', fontWeight: '500', color: 'white' }}>
                  {isSubmitting ? 'Sending...' : 'Send Response'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Status Modal */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <View style={{ flex: 1, justifyContent: tablet ? 'center' : 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: tablet ? 24 : 0, borderBottomRightRadius: tablet ? 24 : 0, padding: 24, width: '100%', maxWidth: tablet ? 700 : undefined, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: colors.text }}>Update Status</Text>
              <TouchableOpacity onPress={() => setShowStatusModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {Object.values(TICKET_STATUS).map((status) => (
              <TouchableOpacity
                key={status}
                style={{
                  backgroundColor: selectedStatus === status ? getStatusColor(status) + '20' : colors.background,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: selectedStatus === status ? getStatusColor(status) : 'transparent',
                }}
                onPress={() => setSelectedStatus(status)}
              >
                <Ionicons
                  name={selectedStatus === status ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selectedStatus === status ? getStatusColor(status) : colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 16,
                    color: selectedStatus === status ? getStatusColor(status) : colors.text,
                    marginLeft: 12,
                    fontWeight: selectedStatus === status ? '600' : '400',
                  }}
                >
                  {getStatusLabel(status)}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={{ backgroundColor: colors.border, borderRadius: 8, padding: 12, flex: 1 }}
                onPress={() => setShowStatusModal(false)}
              >
                <Text style={{ textAlign: 'center', fontWeight: '500', color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 12, flex: 1 }}
                onPress={handleUpdateStatus}
                disabled={isSubmitting || selectedStatus === ticket.status}
              >
                <Text style={{ textAlign: 'center', fontWeight: '500', color: 'white' }}>
                  {isSubmitting ? 'Updating...' : 'Update Status'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}









