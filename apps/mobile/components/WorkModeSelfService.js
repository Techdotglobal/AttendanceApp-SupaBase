import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScreen } from '../shared/components/KeyboardAwareScreen';
import { useTheme } from '../contexts/ThemeContext';
import { getEmployeeByUsername, createWorkModeRequest, getWorkModeRequests } from '../utils/employees';
import {
  getAllWorkModes,
  getWorkModeColor,
  getWorkModeIcon,
  getWorkModeLabel,
} from '../utils/workModes';

function ownRequestsForUser(requests, user) {
  return (requests || []).filter(
    (request) =>
      request.employeeUid === user?.uid ||
      request.employeeId === `emp_${user?.uid}` ||
      request.employeeId === user?.username,
  );
}

/**
 * Shared employee self-service work-mode request UI.
 *
 * EmployeeDashboard and MyWorkModesScreen both render this component so the
 * request/approval contract remains a single implementation.
 */
export default function WorkModeSelfService({ user, employee: providedEmployee = null, myRequests: providedRequests, onRequestsChanged }) {
  const { colors } = useTheme();
  const [loadedEmployee, setLoadedEmployee] = useState(providedEmployee);
  const [loadedRequests, setLoadedRequests] = useState([]);
  const [showWorkModeModal, setShowWorkModeModal] = useState(false);
  const [selectedWorkMode, setSelectedWorkMode] = useState(null);
  const [requestReason, setRequestReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const employee = providedEmployee || loadedEmployee;
  const requests = Array.isArray(providedRequests) ? providedRequests : loadedRequests;
  const hasPendingRequest = useMemo(
    () => requests.some((request) => request.status === 'pending'),
    [requests],
  );

  const loadRequests = useCallback(async () => {
    if (!user?.uid || Array.isArray(providedRequests)) return;
    try {
      const rows = await getWorkModeRequests(user, { ownOnly: true });
      setLoadedRequests(ownRequestsForUser(rows, user));
    } catch (error) {
      console.error('Error loading self-service work mode requests:', error);
    }
  }, [providedRequests, user?.companyId, user?.company_id, user?.uid, user?.username]);

  useEffect(() => {
    let cancelled = false;
    if (!providedEmployee && user?.username) {
      getEmployeeByUsername(user.username, user.companyId || user.company_id)
        .then((row) => {
          if (!cancelled) setLoadedEmployee(row);
        })
        .catch((error) => console.error('Error loading self-service employee:', error));
    }
    void loadRequests();
    return () => {
      cancelled = true;
    };
  }, [loadRequests, providedEmployee, user?.companyId, user?.username]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!selectedWorkMode || !requestReason.trim()) {
      Alert.alert('Validation failed', 'Please select a work mode and provide a reason');
      return;
    }
    if (hasPendingRequest) {
      Alert.alert('Pending Request', 'A pending request already exists.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createWorkModeRequest(
        user.username,
        selectedWorkMode,
        requestReason.trim(),
        user,
      );
      if (!result?.success) {
        Alert.alert('Error', result?.error || 'Failed to submit request');
        return;
      }
      Alert.alert('Request Submitted', result.message || 'Your work mode change request has been submitted for admin approval.');
      setShowWorkModeModal(false);
      setSelectedWorkMode(null);
      setRequestReason('');
      if (Array.isArray(providedRequests)) {
        await onRequestsChanged?.();
      } else {
        await loadRequests();
      }
    } catch (error) {
      console.error('Error submitting work mode request:', error);
      Alert.alert('Error', error?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!employee) {
    return <ActivityIndicator color={colors.primary} />;
  }

  return (
    <>
      <View className="rounded-2xl p-6 shadow-sm" style={{ backgroundColor: colors.surface }}>
        <Text className="text-lg font-semibold mb-4" style={{ color: colors.text }}>
          Work Mode
        </Text>
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center">
            <Ionicons name={getWorkModeIcon(employee.workMode)} size={20} color={getWorkModeColor(employee.workMode)} />
            <View className="ml-3">
              <Text className="font-medium" style={{ color: colors.text }}>
                Current: {getWorkModeLabel(employee.workMode)}
              </Text>
              <Text className="text-sm" style={{ color: colors.textTertiary }}>
                {employee.department} • {employee.position}
              </Text>
            </View>
          </View>
        </View>

        <Text className="text-sm mb-3" style={{ color: colors.textSecondary }}>
          {hasPendingRequest
            ? 'You have a pending work mode request. New requests are disabled until it is processed.'
            : 'Request a different work mode:'}
        </Text>
        <View className="space-y-2">
          {getAllWorkModes()
            .filter((mode) => mode.value !== employee.workMode)
            .map((mode) => (
              <TouchableOpacity
                key={mode.value}
                className="flex-row items-center p-3 rounded-lg"
                style={{ backgroundColor: colors.background, opacity: hasPendingRequest ? 0.5 : 1 }}
                disabled={hasPendingRequest}
                onPress={() => {
                  setSelectedWorkMode(mode.value);
                  setShowWorkModeModal(true);
                }}
              >
                <Ionicons name={mode.icon} size={20} color={mode.color} />
                <View className="ml-3 flex-1">
                  <Text className="font-medium" style={{ color: colors.text }}>{mode.label}</Text>
                  <Text className="text-sm" style={{ color: colors.textTertiary }}>{mode.description}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
        </View>

        {requests.length > 0 && (
          <View className="mt-4 pt-4 border-t" style={{ borderColor: colors.border }}>
            <Text className="text-sm font-medium mb-2" style={{ color: colors.text }}>
              My Requests ({requests.length})
            </Text>
            {requests.slice(0, 2).map((request) => (
              <View key={request.id} className="flex-row items-center justify-between py-2">
                <View>
                  <Text className="text-sm" style={{ color: colors.textSecondary }}>{getWorkModeLabel(request.requestedMode)}</Text>
                  <Text className="text-xs" style={{ color: colors.textTertiary }}>
                    {new Date(request.requestedAt).toLocaleDateString()}
                  </Text>
                </View>
                <View className="px-2 py-1 rounded-full" style={{
                  backgroundColor: request.status === 'pending' ? colors.warningLight : request.status === 'approved' ? colors.successLight : colors.errorLight,
                }}>
                  <Text className="text-xs font-medium" style={{
                    color: request.status === 'pending' ? colors.warning : request.status === 'approved' ? colors.success : colors.error,
                  }}>
                    {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                  </Text>
                </View>
              </View>
            ))}
            {requests.length > 2 && (
              <Text className="text-xs mt-1" style={{ color: colors.textTertiary }}>+{requests.length - 2} more requests</Text>
            )}
          </View>
        )}
      </View>

      <Modal visible={showWorkModeModal} transparent animationType="slide" onRequestClose={() => setShowWorkModeModal(false)}>
        <KeyboardAwareScreen
          inModal
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}
          extraScrollHeight={40}
        >
          <View className="rounded-xl p-6 w-full max-w-sm" style={{ backgroundColor: colors.surface }}>
            <Text className="text-xl font-bold mb-4" style={{ color: colors.text }}>Request Work Mode Change</Text>
            {selectedWorkMode && (
              <View className="mb-4">
                <Text className="mb-2" style={{ color: colors.textSecondary }}>
                  Requesting: <Text className="font-medium">{getWorkModeLabel(selectedWorkMode)}</Text>
                </Text>
                <Text className="text-sm" style={{ color: colors.textTertiary }}>
                  {getAllWorkModes().find((mode) => mode.value === selectedWorkMode)?.description}
                </Text>
              </View>
            )}
            <Text className="font-medium mb-2" style={{ color: colors.text }}>Reason for request:</Text>
            <TextInput
              className="border rounded-lg p-3 mb-4"
              placeholder="Please explain why you need this work mode change..."
              placeholderTextColor={colors.textTertiary}
              value={requestReason}
              onChangeText={setRequestReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.text }}
            />
            <View className="flex-row space-x-3">
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{ backgroundColor: colors.borderLight }}
                onPress={() => {
                  setShowWorkModeModal(false);
                  setSelectedWorkMode(null);
                  setRequestReason('');
                }}
              >
                <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{ backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }}
                disabled={submitting}
                onPress={handleSubmit}
              >
                {submitting ? <ActivityIndicator color="#ffffff" /> : <Text className="text-center font-medium text-white">Submit Request</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareScreen>
      </Modal>
    </>
  );
}
