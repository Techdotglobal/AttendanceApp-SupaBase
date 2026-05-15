import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchTenantDepartments, fetchTenantPositionSuggestions } from '../core/api/tenantOrgApi';
import {
  departmentLookupKey,
  departmentNamesMatch,
  normalizeDepartmentDisplay,
  normalizePositionDisplay,
} from '../utils/orgNormalize';
import { iconSize, responsiveFont, responsivePadding, spacing } from '../utils/responsive';

/**
 * Tenant-scoped department picker + position autocomplete for employee creation.
 */
export default function DepartmentPositionFields({
  requester,
  department,
  position,
  onDepartmentChange,
  onPositionChange,
  colors,
}) {
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [deptFocused, setDeptFocused] = useState(false);
  const [posFocused, setPosFocused] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const loadOrgData = useCallback(async () => {
    if (!requester?.uid) {
      setDepartments([]);
      setPositions([]);
      setDeptLoading(false);
      return;
    }
    setDeptLoading(true);
    setLoadError(null);
    const [deptRes, posRes] = await Promise.all([
      fetchTenantDepartments(requester),
      fetchTenantPositionSuggestions(requester),
    ]);
    if (deptRes.success) {
      setDepartments(deptRes.data || []);
    } else {
      setLoadError(deptRes.error);
      setDepartments([]);
    }
    if (posRes.success) {
      setPositions(posRes.data || []);
    }
    setDeptLoading(false);
  }, [requester?.uid, requester?.role, requester?.companyId]);

  useEffect(() => {
    loadOrgData();
  }, [loadOrgData]);

  const filteredDepartments = useMemo(() => {
    const q = departmentLookupKey(department);
    if (!q) return departments;
    return departments.filter((d) => {
      const name = d.name || '';
      return departmentLookupKey(name).includes(q) || name.toLowerCase().includes(q);
    });
  }, [departments, department]);

  const filteredPositions = useMemo(() => {
    const q = departmentLookupKey(position);
    if (!q) return positions.slice(0, 12);
    return positions
      .filter((p) => departmentLookupKey(p).includes(q) || p.toLowerCase().includes(q))
      .slice(0, 12);
  }, [positions, position]);

  const exactDeptMatch = useMemo(
    () => departments.some((d) => departmentNamesMatch(d.name, department)),
    [departments, department]
  );

  const showDeptDropdown = deptFocused && filteredDepartments.length > 0;
  const showPosDropdown = posFocused && filteredPositions.length > 0;
  const showNewDeptHint =
    !deptLoading && department.trim().length > 0 && !exactDeptMatch && departments.length > 0;
  const showEmptyTenantHint = !deptLoading && departments.length === 0 && !loadError;

  const selectDepartment = (name) => {
    onDepartmentChange(name);
    setDeptFocused(false);
  };

  const selectPosition = (name) => {
    onPositionChange(name);
    setPosFocused(false);
  };

  const renderSuggestionRow = (label, onPress) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: responsivePadding(12),
        borderBottomWidth: 1,
        borderBottomColor: colors.borderLight,
      }}
    >
      <Text style={{ color: colors.text, fontSize: responsiveFont(14) }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <View style={{ marginBottom: spacing.md }}>
        <Text
          className="font-medium"
          style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}
        >
          Department
        </Text>
        <View
          className="flex-row items-center rounded-xl"
          style={{
            backgroundColor: colors.borderLight,
            paddingHorizontal: responsivePadding(16),
            paddingVertical: spacing.md,
          }}
        >
          <Ionicons name="business-outline" size={iconSize.md} color={colors.textSecondary} />
          <TextInput
            className="flex-1"
            placeholder={deptLoading ? 'Loading departments...' : 'Search or type department'}
            value={department}
            onChangeText={onDepartmentChange}
            onFocus={() => setDeptFocused(true)}
            onBlur={() => setTimeout(() => setDeptFocused(false), 200)}
            style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
            placeholderTextColor={colors.textTertiary}
          />
        </View>

        {loadError ? (
          <Text style={{ color: colors.error || '#c62828', fontSize: responsiveFont(12), marginTop: spacing.xs }}>
            {loadError}
          </Text>
        ) : null}

        {showEmptyTenantHint ? (
          <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(12), marginTop: spacing.xs }}>
            No departments exist yet. Type a new department name — it will be created for your company when you
            save this employee.
          </Text>
        ) : null}

        {showNewDeptHint ? (
          <Text style={{ color: colors.primary, fontSize: responsiveFont(12), marginTop: spacing.xs }}>
            New department &quot;{normalizeDepartmentDisplay(department)}&quot; will be created for your company.
          </Text>
        ) : null}

        {showDeptDropdown ? (
          <View
            style={{
              marginTop: spacing.xs,
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.borderLight,
              maxHeight: 180,
            }}
          >
            <FlatList
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              data={filteredDepartments}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => renderSuggestionRow(item.name, () => selectDepartment(item.name))}
            />
          </View>
        ) : null}
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <Text
          className="font-medium"
          style={{ color: colors.text, fontSize: responsiveFont(14), marginBottom: spacing.xs }}
        >
          Position
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(11), marginBottom: spacing.xs }}>
          Job title (flexible). Suggestions come from existing employees in your company.
        </Text>
        <View
          className="flex-row items-center rounded-xl"
          style={{
            backgroundColor: colors.borderLight,
            paddingHorizontal: responsivePadding(16),
            paddingVertical: spacing.md,
          }}
        >
          <Ionicons name="briefcase-outline" size={iconSize.md} color={colors.textSecondary} />
          <TextInput
            className="flex-1"
            placeholder="e.g. Team Lead, AI Engineer"
            value={position}
            onChangeText={onPositionChange}
            onFocus={() => setPosFocused(true)}
            onBlur={() => setTimeout(() => setPosFocused(false), 200)}
            style={{ color: colors.text, fontSize: responsiveFont(14), marginLeft: spacing.md }}
            placeholderTextColor={colors.textTertiary}
          />
        </View>

        {showPosDropdown ? (
          <View
            style={{
              marginTop: spacing.xs,
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.borderLight,
              maxHeight: 160,
            }}
          >
            <FlatList
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              data={filteredPositions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => renderSuggestionRow(item, () => selectPosition(item))}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}

export { normalizeDepartmentDisplay, normalizePositionDisplay };
