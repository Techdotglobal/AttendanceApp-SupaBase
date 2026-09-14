/**
 * Generate Report Button Component
 * Allows Super Admin to generate reports with different date ranges
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { KeyboardAwareModal } from '../../../shared/components/KeyboardAwareScreen';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../core/contexts/ThemeContext';
import { useAuth } from '../../../core/contexts/AuthContext';
import { generateReport, downloadReport, openReport } from '../services/reportService';
import { fontSize, spacing, iconSize, responsiveFont, responsivePadding } from '../../../utils/responsive';

const REPORT_RANGES = [
  { value: 'weekly', label: 'Weekly (Last 7 Days)' },
  { value: 'monthly', label: 'Monthly (Previous Month)' },
  { value: 'yearly', label: 'Yearly (Previous Year)' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom Date Range' },
];

export default function GenerateReportButton({ style }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedRange, setSelectedRange] = useState('monthly');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [lastReportId, setLastReportId] = useState(null);

  // Only show for super admin
  if (!user || user.role !== 'super_admin') {
    return null;
  }

  const handleGenerate = async () => {
    if (selectedRange === 'custom' && (!customFrom || !customTo)) {
      Alert.alert('Error', 'Please select both start and end dates for custom range');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateReport(
        selectedRange,
        selectedRange === 'custom' ? customFrom : null,
        selectedRange === 'custom' ? customTo : null,
        user
      );

      if (result.reportId) {
        setLastReportId(result.reportId);
      }

      const emailStatus = result.emailStatus;
      let title = 'Report Generated';
      let message =
        result.message ||
        'Your report was generated successfully. You can download it below.';

      if (emailStatus === 'sent') {
        title = 'Report Generated & Emailed';
        message =
          'Your PDF report was generated and sent to the configured recipient emails. You can also download it below.';
      } else if (emailStatus === 'failed') {
        title = 'Report Generated';
        message =
          (result.message ||
            'Your PDF was generated, but email delivery failed.') +
          ' You can still download the report below.';
      } else if (emailStatus === 'skipped') {
        title = 'Report Generated';
        message =
          'Your PDF was generated, but no recipient emails are configured. You can download the report below.';
      }

      Alert.alert(title, message, [
        {
          text: 'OK',
          onPress: () => {
            setSelectedRange('monthly');
            setCustomFrom('');
            setCustomTo('');
          },
        },
      ]);
    } catch (error) {
      Alert.alert(
        'Error',
        error.message || 'Failed to generate report. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!lastReportId) {
      Alert.alert('Error', 'No report ID available. Please generate a report first.');
      return;
    }

    setIsDownloading(true);
    try {
      const result = await downloadReport(lastReportId, user);

      if (result.success && result.fileUri) {
        Alert.alert(
          'Download Complete',
          'Report downloaded successfully. Would you like to open or share it?',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Open',
              onPress: async () => {
                try {
                  await openReport(result.fileUri);
                } catch (openError) {
                  Alert.alert(
                    'Error',
                    openError.message ||
                      'Failed to open report. The file has been saved to your device.'
                  );
                }
              },
            },
          ]
        );
      }
    } catch (error) {
      Alert.alert(
        'Download Failed',
        error.message ||
          'Failed to download report. The report may have expired (reports are retained for 7 days).',
        [{ text: 'OK' }]
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.button,
          {
            backgroundColor: colors.primary,
            ...style,
          },
        ]}
        onPress={() => setModalVisible(true)}
        disabled={isGenerating}
      >
        <Ionicons name="document-text-outline" size={iconSize.md} color="white" />
        <Text style={[styles.buttonText, { fontSize: responsiveFont(14) }]}>
          Generate Report
        </Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isGenerating && !isDownloading) {
            setModalVisible(false);
            // Reset form when closing
            setSelectedRange('monthly');
            setCustomFrom('');
            setCustomTo('');
            // Keep lastReportId for potential download after modal closes
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.surface,
              },
            ]}
          >
            <KeyboardAwareModal
              style={styles.modalBodyWrapper}
              contentContainerStyle={styles.modalBodyContent}
              extraScrollHeight={40}
              scrollViewProps={{ style: styles.modalBody }}
            >
            <View style={styles.modalHeader}>
              <Text
                style={[
                  styles.modalTitle,
                  { color: colors.text, fontSize: responsiveFont(18) },
                ]}
              >
                Generate Report
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (!isGenerating && !isDownloading) {
                    setModalVisible(false);
                    // Reset form when closing
                    setSelectedRange('monthly');
                    setCustomFrom('');
                    setCustomTo('');
                    // Keep lastReportId for potential download after modal closes
                  }
                }}
                style={styles.closeButton}
                disabled={isGenerating}
              >
                <Ionicons name="close" size={iconSize.lg} color={colors.text} />
              </TouchableOpacity>
            </View>
              <Text
                style={[
                  styles.label,
                  { color: colors.textSecondary, fontSize: responsiveFont(14) },
                ]}
              >
                Select Report Range:
              </Text>

              {REPORT_RANGES.map((range) => (
                <TouchableOpacity
                  key={range.value}
                  style={[
                    styles.rangeOption,
                    {
                      backgroundColor:
                        selectedRange === range.value
                          ? colors.primaryLight
                          : colors.background,
                      borderColor:
                        selectedRange === range.value ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedRange(range.value)}
                >
                  <Ionicons
                    name={
                      selectedRange === range.value
                        ? 'radio-button-on'
                        : 'radio-button-off'
                    }
                    size={iconSize.md}
                    color={
                      selectedRange === range.value ? colors.primary : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.rangeLabel,
                      {
                        color: colors.text,
                        fontSize: responsiveFont(14),
                        marginLeft: spacing.sm,
                      },
                    ]}
                  >
                    {range.label}
                  </Text>
                </TouchableOpacity>
              ))}

              {selectedRange === 'custom' && (
                <View style={styles.customRangeContainer}>
                  <Text
                    style={[
                      styles.label,
                      { color: colors.textSecondary, fontSize: responsiveFont(14), marginTop: spacing.md },
                    ]}
                  >
                    Start Date (YYYY-MM-DD):
                  </Text>
                  <TextInput
                    style={[
                      styles.dateInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        fontSize: responsiveFont(14),
                      },
                    ]}
                    placeholder="2024-01-01"
                    placeholderTextColor={colors.textTertiary}
                    value={customFrom}
                    onChangeText={setCustomFrom}
                    editable={!isGenerating}
                  />
                  
                  <Text
                    style={[
                      styles.label,
                      { color: colors.textSecondary, fontSize: responsiveFont(14), marginTop: spacing.md },
                    ]}
                  >
                    End Date (YYYY-MM-DD):
                  </Text>
                  <TextInput
                    style={[
                      styles.dateInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        fontSize: responsiveFont(14),
                      },
                    ]}
                    placeholder="2024-01-31"
                    placeholderTextColor={colors.textTertiary}
                    value={customTo}
                    onChangeText={setCustomTo}
                    editable={!isGenerating}
                  />
                  
                  <Text
                    style={[
                      styles.hint,
                      { color: colors.textTertiary, fontSize: responsiveFont(12), marginTop: spacing.xs },
                    ]}
                  >
                    Enter dates in YYYY-MM-DD format (e.g., 2024-01-01)
                  </Text>
                </View>
              )}

              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[
                    styles.generateButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: isGenerating ? 0.6 : 1,
                    },
                  ]}
                  onPress={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="document-text" size={iconSize.md} color="white" />
                      <Text
                        style={[
                          styles.generateButtonText,
                          { fontSize: responsiveFont(14), marginLeft: spacing.xs },
                        ]}
                      >
                        Generate Report
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Download Button - Show when reportId is available */}
                {lastReportId && (
                  <TouchableOpacity
                    style={[
                      styles.downloadButton,
                      {
                        backgroundColor: colors.success || '#4CAF50',
                        opacity: isDownloading ? 0.6 : 1,
                        marginTop: spacing.md,
                      },
                    ]}
                    onPress={handleDownload}
                    disabled={isDownloading || isGenerating}
                  >
                    {isDownloading ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <>
                        <Ionicons name="download" size={iconSize.md} color="white" />
                        <Text
                          style={[
                            styles.generateButtonText,
                            { fontSize: responsiveFont(14), marginLeft: spacing.xs },
                          ]}
                        >
                          Download Report
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </KeyboardAwareModal>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    marginVertical: spacing.sm,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxWidth: 500,
    borderRadius: 16,
    padding: spacing.lg,
    maxHeight: '85%',
    // Ensure modal doesn't overflow screen
    alignSelf: 'center',
    // Ensure proper layout
    flexShrink: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontWeight: 'bold',
  },
  closeButton: {
    padding: spacing.xs,
  },
  modalBodyWrapper: {
    // Overrides KeyboardAwareModal's hardcoded flex: 1. modalContent (this
    // wrapper's parent) is content-sized (maxHeight only, no explicit
    // height) — a flex: 1 child there has nothing definite to resolve
    // against and collapses to zero height, which is why the modal
    // rendered as a dark backdrop with no visible form. flexShrink: 1
    // keeps it shrinking (and the ScrollView below scrollable) if content
    // ever exceeds modalContent's maxHeight.
    flex: 0,
    flexShrink: 1,
  },
  modalBody: {
    // flex: 1 here was the same class of bug as modalBodyWrapper above,
    // just on the ScrollView's own style instead of the wrapper actually
    // forcing it — removing it alone didn't fix anything, since
    // KeyboardAwareModal's internal KeyboardAvoidingView still forced
    // flex: 1 regardless. ScrollView will handle scrolling on its own.
  },
  modalBodyContent: {
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  label: {
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  rangeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  rangeLabel: {
    flex: 1,
  },
  customRangeContainer: {
    marginTop: spacing.md,
  },
  dateInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  hint: {
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  buttonContainer: {
    marginTop: spacing.lg,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
  },
  generateButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
  },
});

