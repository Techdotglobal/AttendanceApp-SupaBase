import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';
import { isHRAdmin } from '../shared/constants/roles';
import { supabase } from '../core/config/supabase';
import { deleteUserAccount } from '../utils/auth';
import { spacing, responsivePadding, responsiveFont, iconSize } from '../utils/responsive';

export default function DeleteUserScreen({ route }) {
  const { colors } = useTheme();
  const { user: authUser } = useAuth();
  const currentUser = route?.params?.user || authUser;

  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingUid, setDeletingUid] = useState(null);

  const canAccess = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.role === 'super_admin' || isHRAdmin(currentUser);
  }, [currentUser]);

  const showSuccessToast = (message) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert('Success', message);
  };

  const canDeleteTarget = (targetUser) => {
    if (!currentUser || !targetUser) return false;

    // Never allow deleting Super Admin accounts
    if (targetUser.role === 'super_admin') {
      return false;
    }

    if (targetUser.uid === currentUser.uid) {
      return false;
    }

    if (currentUser.role === 'super_admin') {
      return true;
    }

    if (isHRAdmin(currentUser)) {
      return (
        targetUser.role === 'employee' ||
        targetUser.role === 'manager'
      );
    }

    return false;
  };

  const loadUsers = useCallback(async () => {
    if (!canAccess) {
      setUsers([]);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('uid, username, name, role, department')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        throw error;
      }

      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading users:', error);
      Alert.alert('Error', error.message || 'Failed to load users');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canAccess]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleDelete = (targetUser) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this user?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingUid(targetUser.uid);
            try {
              const result = await deleteUserAccount(targetUser.uid, {
                uid: currentUser.uid,
                role: currentUser.role,
                department: currentUser.department,
              });

              if (!result.success) {
                Alert.alert('Delete Failed', result.error || 'Failed to delete user');
                return;
              }

              showSuccessToast('User deleted successfully');
              await loadUsers();
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to delete user');
            } finally {
              setDeletingUid(null);
            }
          },
        },
      ]
    );
  };

  const renderUser = ({ item }) => {
    const isDeleting = deletingUid === item.uid;
    const allowedToDelete = canDeleteTarget(item);

    return (
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 12,
          padding: responsivePadding(16),
          marginBottom: spacing.sm,
          borderWidth: 1,
          borderColor: colors.borderLight,
        }}
      >
        <Text style={{ color: colors.text, fontSize: responsiveFont(16), fontWeight: '700' }}>
          {item.name || item.username || 'Unknown User'}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(13), marginTop: spacing.xs }}>
          Username: {item.username || '-'}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(13), marginTop: spacing.xs }}>
          Role: {item.role || '-'}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(13), marginTop: spacing.xs }}>
          Department: {item.department || '-'}
        </Text>

        <TouchableOpacity
          onPress={() => handleDelete(item)}
          disabled={!allowedToDelete || isDeleting}
          activeOpacity={0.8}
          style={{
            marginTop: spacing.md,
            backgroundColor: !allowedToDelete || isDeleting ? colors.border : '#dc2626',
            borderRadius: 10,
            paddingVertical: spacing.sm,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: spacing.xs,
          }}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="trash-outline" size={iconSize.sm} color="#ffffff" />
          )}
          <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: responsiveFont(14) }}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (!canAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: responsivePadding(24) }}>
        <Ionicons name="lock-closed-outline" size={28} color={colors.textSecondary} />
        <Text style={{ color: colors.text, fontSize: responsiveFont(18), fontWeight: '700', marginTop: spacing.sm }}>
          Access Denied
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(14), marginTop: spacing.xs, textAlign: 'center' }}>
          Only Super Admin and HR Manager can access this screen.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: responsivePadding(16) }}>
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: spacing.sm, color: colors.textSecondary }}>Loading users...</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.uid}
          renderItem={renderUser}
          refreshing={isRefreshing}
          onRefresh={() => {
            setIsRefreshing(true);
            loadUsers();
          }}
          ListEmptyComponent={
            <View style={{ paddingTop: spacing['2xl'], alignItems: 'center' }}>
              <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(14) }}>
                No users found.
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      )}
    </View>
  );
}
