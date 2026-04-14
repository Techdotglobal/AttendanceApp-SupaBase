import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Image,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getUserAttendanceRecords } from '../utils/storage';
import { fontSize, spacing, iconSize, componentSize, responsivePadding, responsiveFont, isTablet, normalize } from '../utils/responsive';
import { useTheme } from '../contexts/ThemeContext';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';

export default function AttendanceHistory({ route }) {
  const { user } = route.params;
  const { colors } = useTheme();
  const tablet = isTablet();
  const tabletContentStyle = {
    width: '100%',
    maxWidth: tablet ? 1000 : undefined,
    alignSelf: 'center',
  };
  const [records, setRecords] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState('all'); // all, checkin, checkout

  useEffect(() => {
    loadRecords();
  }, [filter]);

  const loadRecords = async () => {
    try {
      // Use username to get records
      const allRecords = await getUserAttendanceRecords(user.username);
      
      // Sort by timestamp (newest first)
      const sortedRecords = allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Apply filter
      let filteredRecords = sortedRecords;
      if (filter !== 'all') {
        filteredRecords = sortedRecords.filter(record => record.type === filter);
      }
      
      setRecords(filteredRecords);
    } catch (error) {
      console.error('Error loading records:', error);
      Alert.alert('Error', 'Failed to load attendance records');
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadRecords();
    setIsRefreshing(false);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString(),
    };
  };

  const getStatusColor = (type) => {
    return type === 'checkin' ? '#10b981' : '#ef4444';
  };

  const getStatusIcon = (type) => {
    return type === 'checkin' ? 'log-in' : 'log-out';
  };

  const renderRecord = ({ item }) => {
    const { date, time } = formatDate(item.timestamp);
    const statusColor = item.type === 'checkin' ? colors.success : colors.error;
    
    return (
      <View 
        className="rounded-xl shadow-sm"
        style={{
          backgroundColor: colors.surface,
          padding: responsivePadding(16),
          marginBottom: spacing.md,
          marginHorizontal: spacing.sm,
        }}
      >
        <View className="flex-row items-start">
          {/* Status Indicator */}
          <View style={{ marginRight: spacing.md }}>
            <View 
              className="rounded-full items-center justify-center"
              style={{ 
                width: componentSize.avatarMedium,
                height: componentSize.avatarMedium,
                backgroundColor: `${statusColor}20` 
              }}
            >
              <Ionicons 
                name={getStatusIcon(item.type)} 
                size={iconSize.md} 
                color={statusColor} 
              />
            </View>
          </View>

          {/* Record Details */}
          <View className="flex-1" style={{ flexShrink: 1 }}>
            <View className="flex-row items-center justify-between" style={{ marginBottom: spacing.xs }}>
              <Text 
                className="font-semibold capitalize"
                style={{ 
                  color: colors.text,
                  fontSize: responsiveFont(18) 
                }}
              >
                {item.type === 'checkin' ? 'Check In' : 'Check Out'}
              </Text>
              <Text 
                style={{ 
                  color: colors.textTertiary,
                  fontSize: responsiveFont(12) 
                }}
              >
                {time}
              </Text>
            </View>
            
            <Text 
              style={{ 
                color: colors.textSecondary,
                fontSize: responsiveFont(14),
                marginBottom: spacing.xs,
              }}
            >
              {date}
            </Text>
            
            {/* Location */}
            {item.location && (
              <View className="flex-row items-center" style={{ marginBottom: spacing.xs }}>
                <Ionicons name="location-outline" size={iconSize.sm} color={colors.textSecondary} />
                <Text 
                  className="ml-1 flex-1"
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12) 
                  }}
                  numberOfLines={1}
                >
                  {item.location.address || 
                   (item.location.latitude !== undefined && item.location.longitude !== undefined
                     ? `${(item.location.latitude ?? 0).toFixed(4)}, ${(item.location.longitude ?? 0).toFixed(4)}`
                     : 'Location unavailable')}
                </Text>
              </View>
            )}

            {/* Photo */}
            {item.photo && (
              <View style={{ marginTop: spacing.xs }}>
                <Image 
                  source={{ uri: item.photo }} 
                  className="rounded-lg"
                  style={{ 
                    width: componentSize.avatarLarge,
                    height: componentSize.avatarLarge,
                  }}
                  resizeMode="cover"
                />
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const FilterButton = ({ title, value, isActive }) => (
    <TouchableOpacity
      className="rounded-full"
      style={{
        backgroundColor: isActive ? colors.primary : colors.borderLight,
        paddingHorizontal: responsivePadding(16),
        paddingVertical: spacing.xs,
        marginRight: spacing.xs,
      }}
      onPress={() => setFilter(value)}
    >
      <Text 
        className="font-medium"
        style={{ 
          color: isActive ? '#ffffff' : colors.text,
          fontSize: responsiveFont(14) 
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View 
        className="shadow-sm"
        style={{
          ...tabletContentStyle,
          backgroundColor: colors.surface,
          paddingHorizontal: responsivePadding(24),
          paddingVertical: responsivePadding(16),
        }}
      >
        <View className="flex-row items-center" style={{ marginBottom: spacing.md }}>
          <Logo size="small" style={{ marginRight: spacing.sm }} />
          <Text 
            className="font-bold"
            style={{ 
              color: colors.text,
              fontSize: responsiveFont(20),
            }}
          >
          Attendance History
        </Text>
        </View>
        
        {/* Filter Buttons */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: responsivePadding(16) }}
        >
          <View className="flex-row">
          <FilterButton title="All" value="all" isActive={filter === 'all'} />
          <FilterButton title="Check In" value="checkin" isActive={filter === 'checkin'} />
          <FilterButton title="Check Out" value="checkout" isActive={filter === 'checkout'} />
        </View>
        </ScrollView>
      </View>

      {/* Records List */}
      {records.length > 0 ? (
        <FlatList
          data={records}
          renderItem={renderRecord}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ ...tabletContentStyle, padding: 16 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View 
          className="flex-1 justify-center items-center"
          style={{ ...tabletContentStyle, paddingHorizontal: responsivePadding(24) }}
        >
          <Ionicons name="time-outline" size={iconSize['4xl']} color={colors.textTertiary} />
          <Text 
            className="font-semibold text-center"
            style={{ 
              color: colors.textSecondary,
              fontSize: responsiveFont(20),
              marginTop: spacing.md,
            }}
          >
            No attendance records found
          </Text>
          <Text 
            className="text-center"
            style={{ 
              color: colors.textTertiary,
              fontSize: responsiveFont(14),
              marginTop: spacing.xs,
            }}
          >
            {filter === 'all' 
              ? 'Start by checking in to create your first record'
              : `No ${filter} records found`
            }
          </Text>
          <TouchableOpacity
            className="rounded-xl"
            style={{
              backgroundColor: colors.primary,
              paddingHorizontal: responsivePadding(24),
              paddingVertical: spacing.md,
              marginTop: spacing.lg,
            }}
            onPress={onRefresh}
          >
            <Text 
              className="text-white font-semibold"
              style={{ fontSize: responsiveFont(16) }}
            >
              Refresh
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Summary */}
      {records.length > 0 && (
        <View 
          className="border-t"
          style={{ 
            ...tabletContentStyle,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            padding: responsivePadding(16) 
          }}
        >
          <Text 
            className="text-center"
            style={{ 
              color: colors.textSecondary,
              fontSize: responsiveFont(14) 
            }}
          >
            Showing {records.length} record{records.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Trademark */}
      <View style={{ ...tabletContentStyle, padding: responsivePadding(16) }}>
        <Trademark position="bottom" />
      </View>
    </View>
  );
}
