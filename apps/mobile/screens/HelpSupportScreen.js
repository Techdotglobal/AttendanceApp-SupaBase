import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  Modal,
  Linking,
  Platform,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../core/contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';
import { fontSize, spacing, iconSize, responsiveFont, responsivePadding } from '../utils/responsive';
import { KeyboardAwareScreen } from '../shared/components/KeyboardAwareScreen';
import { ActionButton } from '../shared/components/ActionButton';
import { SUPPORT } from '../shared/constants/support';

function ContactCard({ icon, title, value, subtitle, onPress, colors }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: 12,
        padding: responsivePadding(14),
        marginBottom: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.primaryLight,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.md,
        }}
      >
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: colors.primary, fontSize: responsiveFont(14), fontWeight: '600', marginTop: 2 }}>{value}</Text>
        {subtitle ? (
          <Text style={{ color: colors.textTertiary, fontSize: responsiveFont(11), marginTop: 2 }}>{subtitle}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function HelpSupportScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [fallbackEmailData, setFallbackEmailData] = useState(null);

  const roleDisplay = (user?.role || 'employee').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  const buildEmailPayload = () => {
    const subject = `[${SUPPORT.appName} Support] ${roleDisplay} Issue`;
    const body = `User: ${user?.name || user?.username || 'Unknown'}
Email: ${user?.email || 'Not provided'}
Role: ${roleDisplay}

Message:
${message.trim()}`;
    return { subject, body, mailto: `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
  };

  const openUrl = async (url, fallbackMessage, { silent = false } = {}) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      /* fall through */
    }
    // Callers with their own fallback UI (e.g. the "no email app" sheet
    // below) pass silent so the user doesn't see this generic alert and
    // then a second, better-informed one right after it.
    if (!silent) Alert.alert('Unable to open', fallbackMessage);
    return false;
  };

  const handleSend = async () => {
    if (!message.trim()) {
      Alert.alert('Message required', 'Please describe your issue before sending.');
      return;
    }
    setIsSending(true);
    try {
      const { subject, body, mailto } = buildEmailPayload();
      const opened = await openUrl(mailto, null, { silent: true });
      if (opened) {
        Alert.alert('Email ready', SUPPORT.responseTime, [
          { text: 'OK', onPress: () => { setMessage(''); navigation.goBack(); } },
        ]);
      } else {
        setFallbackEmailData({ email: SUPPORT.email, subject, body, fullText: `To: ${SUPPORT.email}\nSubject: ${subject}\n\n${body}` });
        setShowFallbackModal(true);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <KeyboardAwareScreen
        contentContainerStyle={{ padding: responsivePadding(16), paddingBottom: spacing['2xl'] }}
        headerHeight={88}
      >
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: responsivePadding(20), marginBottom: spacing.lg }}>
          <View style={{ alignSelf: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md }}>
            <Ionicons name="help-circle" size={32} color={colors.primary} />
          </View>
          <Text style={{ color: colors.text, fontSize: responsiveFont(24), fontWeight: '700', textAlign: 'center' }}>Help & Support</Text>
          <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(14), textAlign: 'center', marginTop: spacing.xs }}>
            {SUPPORT.responseTime}
          </Text>
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: responsivePadding(16), marginBottom: spacing.lg }}>
          <Text style={{ color: colors.text, fontSize: responsiveFont(16), fontWeight: '600', marginBottom: spacing.md }}>Contact us</Text>
          <ContactCard
            icon="mail-outline"
            title="Email support"
            value={SUPPORT.email}
            subtitle="Best for detailed issues"
            colors={colors}
            onPress={() => openUrl(`mailto:${SUPPORT.email}?subject=${encodeURIComponent(`[${SUPPORT.appName}] Support`)}`, `Email us at ${SUPPORT.email}`)}
          />
          <ContactCard
            icon="call-outline"
            title="Phone"
            value={SUPPORT.phone}
            subtitle={SUPPORT.hours}
            colors={colors}
            onPress={() => openUrl(`tel:${SUPPORT.phoneTel}`, `Call ${SUPPORT.phone}`)}
          />
          <ContactCard
            icon="globe-outline"
            title="Website"
            value="techdotglobal.com"
            subtitle="Documentation & company info"
            colors={colors}
            onPress={() => openUrl(SUPPORT.website, `Visit ${SUPPORT.website}`)}
          />
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: responsivePadding(16), marginBottom: spacing.lg }}>
          <Text style={{ color: colors.text, fontSize: responsiveFont(16), fontWeight: '600', marginBottom: spacing.md }}>Your message</Text>
          <TextInput
            style={{
              backgroundColor: colors.background,
              borderRadius: 12,
              padding: responsivePadding(16),
              minHeight: 140,
              color: colors.text,
              fontSize: responsiveFont(14),
              textAlignVertical: 'top',
              borderWidth: 1,
              borderColor: colors.border,
            }}
            placeholder="Describe your problem, steps to reproduce, or question…"
            placeholderTextColor={colors.textTertiary}
            value={message}
            onChangeText={setMessage}
            multiline
            editable={!isSending}
            accessibilityLabel="Support message"
          />
          <Text style={{ color: colors.textTertiary, fontSize: responsiveFont(12), marginTop: spacing.xs, textAlign: 'right' }}>
            {message.length} characters
          </Text>
        </View>

        <ActionButton
          label="Send via email"
          icon="send"
          colors={colors}
          onPress={handleSend}
          loading={isSending}
          disabled={!message.trim()}
        />
      </KeyboardAwareScreen>

      <Modal visible={showFallbackModal} transparent animationType="slide" onRequestClose={() => setShowFallbackModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: responsivePadding(24), maxHeight: '90%' }}>
            <Text style={{ color: colors.text, fontSize: responsiveFont(18), fontWeight: '700', marginBottom: spacing.md }}>No email app found</Text>
            {fallbackEmailData && (
              <>
                <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(13), marginBottom: spacing.md }} selectable>
                  {fallbackEmailData.fullText}
                </Text>
                <ActionButton
                  label="Copy to clipboard"
                  icon="copy-outline"
                  colors={colors}
                  onPress={async () => {
                    if (Clipboard?.setString) {
                      Clipboard.setString(fallbackEmailData.fullText);
                      Alert.alert('Copied', 'Email content copied to clipboard.');
                    } else {
                      Alert.alert('Copy manually', fallbackEmailData.fullText);
                    }
                  }}
                />
              </>
            )}
            <ActionButton label="Close" variant="secondary" colors={colors} onPress={() => setShowFallbackModal(false)} style={{ marginTop: spacing.sm }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
