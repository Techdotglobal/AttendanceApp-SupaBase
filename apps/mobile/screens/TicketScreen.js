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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createTicket,
  getUserTickets,
  getCategoryLabel,
  getPriorityLabel,
  getStatusLabel,
  getPriorityColor,
  getStatusColor,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUS,
} from '../utils/ticketManagement';
import { useTheme } from '../contexts/ThemeContext';
import { spacing, fontSize, responsivePadding, responsiveFont, iconSize, isTablet } from '../shared/utils/responsive';

export default function TicketScreen({ navigation, route }) {
  const { user } = route.params;
  const { colors } = useTheme();
  const tablet = isTablet();
  const tabletContentStyle = {
    width: '100%',
    maxWidth: tablet ? 1000 : undefined,
    alignSelf: 'center',
  };
  const [tickets, setTickets] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState('all'); // all, open, in_progress, resolved, closed
  
  // Form state
  const [category, setCategory] = useState(TICKET_CATEGORIES.HR);
  const [priority, setPriority] = useState(TICKET_PRIORITIES.MEDIUM);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadTickets();
    
    // Safely check if navigation and addListener exist
    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('focus', () => {
          loadTickets();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[TicketScreen] Failed to add navigation listener:', error);
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
            console.warn('[TicketScreen] Error unsubscribing navigation listener:', error);
          }
        }
      }
    };
  }, [navigation, filter]);

  const loadTickets = async () => {
    try {
      const userTickets = await getUserTickets(user.username);
      // Sort by created date (newest first)
      const sorted = userTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      // Apply filter
      let filtered = sorted;
      if (filter !== 'all') {
        filtered = sorted.filter(ticket => ticket.status === filter);
      }
      
      setTickets(filtered);
    } catch (error) {
      console.error('Error loading tickets:', error);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadTickets();
    setIsRefreshing(false);
  };

  const handleCreateTicket = async () => {
    if (!subject.trim() || !description.trim()) {
      Alert.alert('Error', 'Please fill in subject and description');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createTicket(
        user.username,
        category,
        priority,
        subject,
        description
      );

      if (result.success) {
        Alert.alert('Success', 'Ticket created successfully');
        setShowCreateModal(false);
        setSubject('');
        setDescription('');
        setCategory(TICKET_CATEGORIES.HR);
        setPriority(TICKET_PRIORITIES.MEDIUM);
        await loadTickets();
      } else {
        Alert.alert('Error', result.error || 'Failed to create ticket');
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      Alert.alert('Error', 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderTicket = ({ item }) => (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: responsivePadding(16),
        marginBottom: spacing.md,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs }}>
        <View style={{ flex: 1, flexShrink: 1 }}>
          <Text
            style={{
              fontSize: responsiveFont(18),
              fontWeight: '600',
              color: colors.text,
              marginBottom: spacing.xs / 2,
            }}
          >
            {item.subject}
          </Text>
          <Text
            style={{
              fontSize: fontSize.sm,
              color: colors.textTertiary,
            }}
          >
            Created {formatDate(item.createdAt)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: spacing.xs }}>
          <View
            style={{
              backgroundColor: getStatusColor(item.status) + '20',
              borderRadius: 12,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs / 2,
              marginBottom: spacing.xs / 2,
            }}
          >
            <Text
              style={{
                fontSize: fontSize.sm,
                fontWeight: '600',
                color: getStatusColor(item.status),
              }}
            >
              {getStatusLabel(item.status)}
            </Text>
          </View>
          <View
            style={{
              backgroundColor: getPriorityColor(item.priority) + '20',
              borderRadius: 12,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs / 2,
            }}
          >
            <Text
              style={{
                fontSize: fontSize.sm,
                fontWeight: '600',
                color: getPriorityColor(item.priority),
              }}
            >
              {getPriorityLabel(item.priority)}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: spacing.xs }}>
        <Ionicons name="pricetag-outline" size={iconSize.sm} color={colors.textSecondary} />
        <Text
          style={{
            fontSize: fontSize.base,
            color: colors.textSecondary,
            marginLeft: spacing.xs,
          }}
        >
          {getCategoryLabel(item.category)}
        </Text>
        {item.assignedTo && (
          <>
            <Text style={{ color: colors.textTertiary, marginHorizontal: spacing.xs }}>•</Text>
            <Ionicons name="person-outline" size={iconSize.sm} color={colors.textSecondary} />
            <Text
              style={{
                fontSize: fontSize.base,
                color: colors.textSecondary,
                marginLeft: spacing.xs,
              }}
            >
              Assigned to {item.assignedTo}
            </Text>
          </>
        )}
      </View>

      <Text
        style={{
          fontSize: fontSize.base,
          color: colors.textSecondary,
          marginBottom: spacing.xs,
        }}
      >
        {item.description}
      </Text>

      {item.responses && item.responses.length > 0 && (
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: 8,
            padding: spacing.md,
            marginTop: spacing.xs,
          }}
        >
          <Text
            style={{
              fontSize: fontSize.sm,
              fontWeight: '600',
              color: colors.text,
              marginBottom: spacing.xs / 2,
            }}
          >
            {item.responses.length} Response{item.responses.length !== 1 ? 's' : ''}
          </Text>
          {item.responses.slice(-1).map((response) => (
            <View key={response.id} style={{ marginTop: spacing.xs / 2 }}>
              <Text
                style={{
                  fontSize: fontSize.sm,
                  color: colors.textSecondary,
                }}
              >
                {response.respondedBy}: {response.message}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          ...tabletContentStyle,
          backgroundColor: colors.surface,
          paddingHorizontal: responsivePadding(16),
          paddingVertical: spacing.md,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Text
            style={{
              fontSize: responsiveFont(20),
              fontWeight: 'bold',
              color: colors.text,
            }}
          >
            My Tickets
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingHorizontal: responsivePadding(16),
              paddingVertical: spacing.xs,
              marginTop: spacing.xs,
            }}
            onPress={() => setShowCreateModal(true)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="add" size={iconSize.md} color="white" />
              <Text
                style={{
                  color: 'white',
                  fontWeight: '600',
                  marginLeft: spacing.xs / 2,
                  fontSize: fontSize.sm,
                }}
              >
                New Ticket
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Filter Tabs - Responsive: wraps on small screens */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, gap: spacing.xs }}>
          {['all', TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].map((filterType) => (
            <TouchableOpacity
              key={filterType}
              onPress={() => setFilter(filterType)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: 16,
                backgroundColor: filter === filterType ? colors.primary : colors.background,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: filter === filterType ? 'white' : colors.textSecondary,
                  fontWeight: filter === filterType ? '600' : '400',
                  fontSize: fontSize.sm,
                  textTransform: 'capitalize',
                }}
              >
                {filterType === 'all' ? 'All' : getStatusLabel(filterType)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Tickets List */}
      {tickets.length > 0 ? (
        <FlatList
          data={tickets}
          renderItem={renderTicket}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ ...tabletContentStyle, padding: responsivePadding(16), paddingBottom: spacing['2xl'] }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        >
          <Ionicons name="ticket-outline" size={iconSize['4xl']} color={colors.textTertiary} />
          <Text
            style={{
              fontSize: responsiveFont(18),
              fontWeight: '600',
              color: colors.text,
              marginTop: spacing.base,
            }}
          >
            No tickets
          </Text>
          <Text
            style={{
              fontSize: fontSize.base,
              color: colors.textSecondary,
              marginTop: spacing.xs,
              textAlign: 'center',
            }}
          >
            {filter === 'all'
              ? 'You don\'t have any tickets yet. Tap "New Ticket" to create one.'
              : `No ${getStatusLabel(filter).toLowerCase()} tickets`}
          </Text>
        </ScrollView>
      )}

      {/* Create Ticket Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View
            style={{
              flex: 1,
              justifyContent: tablet ? 'center' : 'flex-end',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
            }}
          >
            <View
              style={{
                backgroundColor: colors.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderBottomLeftRadius: tablet ? 24 : 0,
                borderBottomRightRadius: tablet ? 24 : 0,
                padding: responsivePadding(24),
                maxHeight: tablet ? '85%' : '90%',
                width: '100%',
                maxWidth: tablet ? 700 : undefined,
                alignSelf: 'center',
              }}
            >
              <ScrollView 
                showsVerticalScrollIndicator={false} 
                contentContainerStyle={{ paddingBottom: spacing['2xl'] }}
                keyboardShouldPersistTaps="handled"
              >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.base }}>
                <Text
                  style={{
                    fontSize: responsiveFont(20),
                    fontWeight: 'bold',
                    color: colors.text,
                  }}
                >
                  Create New Ticket
                </Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                  <Ionicons name="close" size={iconSize.lg} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Category */}
              <View style={{ marginBottom: spacing.base }}>
                <Text style={{ color: colors.text, marginBottom: spacing.xs, fontWeight: '500', fontSize: fontSize.md }}>Category *</Text>
                <Text style={{ color: colors.textSecondary, marginBottom: spacing.xs, fontSize: fontSize.sm }}>
                  Select the department manager who should handle this ticket
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {/* Show only: HR, Finance, Engineering, Sales, Technical (all enabled for everyone) */}
                  {[
                    TICKET_CATEGORIES.HR,
                    TICKET_CATEGORIES.FINANCE,
                    TICKET_CATEGORIES.ENGINEERING,
                    TICKET_CATEGORIES.SALES,
                    TICKET_CATEGORIES.TECHNICAL,
                  ].map((cat) => {
                    const isSelected = category === cat;
                    
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={{
                          borderRadius: 8,
                          padding: spacing.md,
                          borderWidth: 2,
                          borderColor: isSelected ? colors.primary : colors.border,
                          backgroundColor: isSelected ? colors.primaryLight : 'transparent',
                          minWidth: '30%',
                          flex: 1,
                          maxWidth: '48%', // Prevent too wide on larger screens
                        }}
                        onPress={() => setCategory(cat)}
                      >
                        <Text
                          style={{
                            textAlign: 'center',
                            fontSize: fontSize.sm,
                            fontWeight: '500',
                            color: isSelected ? colors.primary : colors.text,
                          }}
                        >
                          {getCategoryLabel(cat)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Priority */}
              <View style={{ marginBottom: spacing.base }}>
                <Text style={{ color: colors.text, marginBottom: spacing.xs, fontWeight: '500', fontSize: fontSize.md }}>Priority *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {Object.values(TICKET_PRIORITIES).map((pri) => (
                    <TouchableOpacity
                      key={pri}
                      style={{
                        borderRadius: 8,
                        padding: spacing.md,
                        borderWidth: 2,
                        borderColor: priority === pri ? getPriorityColor(pri) : colors.border,
                        backgroundColor: priority === pri ? getPriorityColor(pri) + '20' : 'transparent',
                        minWidth: '22%',
                        flex: 1,
                        maxWidth: '48%',
                      }}
                      onPress={() => setPriority(pri)}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: fontSize.sm,
                          fontWeight: '500',
                          color: priority === pri ? getPriorityColor(pri) : colors.text,
                        }}
                      >
                        {getPriorityLabel(pri)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Subject */}
              <View style={{ marginBottom: spacing.base }}>
                <Text style={{ color: colors.text, marginBottom: spacing.xs, fontWeight: '500', fontSize: fontSize.md }}>Subject *</Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingHorizontal: responsivePadding(16),
                    paddingVertical: spacing.md,
                    color: colors.text,
                    fontSize: fontSize.base,
                  }}
                  placeholder="Enter ticket subject"
                  placeholderTextColor={colors.textTertiary}
                  value={subject}
                  onChangeText={setSubject}
                />
              </View>

              {/* Description */}
              <View style={{ marginBottom: spacing.base }}>
                <Text style={{ color: colors.text, marginBottom: spacing.xs, fontWeight: '500', fontSize: fontSize.md }}>Description *</Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingHorizontal: responsivePadding(16),
                    paddingVertical: spacing.md,
                    color: colors.text,
                    minHeight: 100,
                    textAlignVertical: 'top',
                    fontSize: fontSize.base,
                  }}
                  placeholder="Describe your issue in detail..."
                  placeholderTextColor={colors.textTertiary}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={5}
                />
              </View>

              {/* Action Buttons - Responsive: wraps on small screens */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.base }}>
                <TouchableOpacity
                  style={{
                    backgroundColor: colors.border,
                    borderRadius: 8,
                    padding: spacing.md,
                    flex: 1,
                    minWidth: 120,
                  }}
                  onPress={() => setShowCreateModal(false)}
                >
                  <Text style={{ textAlign: 'center', fontWeight: '500', color: colors.text, fontSize: fontSize.base }}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 8,
                    padding: spacing.md,
                    flex: 1,
                    minWidth: 120,
                  }}
                  onPress={handleCreateTicket}
                  disabled={isSubmitting}
                >
                  <Text style={{ textAlign: 'center', fontWeight: '500', color: 'white', fontSize: fontSize.base }}>
                    {isSubmitting ? 'Creating...' : 'Create Ticket'}
                  </Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}









