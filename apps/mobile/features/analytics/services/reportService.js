/**
 * Report Service - Frontend service for generating reports
 */
import { API_GATEWAY_URL, API_TIMEOUT } from '../../../core/config/api';
import * as FileSystem from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Linking, Platform } from 'react-native';

/**
 * Generate a report
 * @param {string} range - Report range: 'weekly', 'monthly', 'yearly', 'all', or 'custom'
 * @param {string} from - Start date (ISO format) - optional, required for custom
 * @param {string} to - End date (ISO format) - optional, required for custom
 * @param {Object} user - User object with email and id
 * @returns {Promise<Object>} API response
 */
export async function generateReport(range, from = null, to = null, user = null) {
  try {
    // Validate API Gateway URL
    if (!API_GATEWAY_URL || API_GATEWAY_URL.includes('localhost') || API_GATEWAY_URL.includes('undefined')) {
      throw new Error('API Gateway is not configured. Please check your app configuration.');
    }

    const headers = {
      'Content-Type': 'application/json',
    };

    // Add authentication headers if user is available
    // Backend expects x-user-id or x-user-email to verify super_admin role
    if (user) {
      // Prefer uid (Supabase Auth ID) as it matches the database uid column
      // This is more reliable than the 'id' field which might have different formats
      if (user.uid) {
        headers['x-user-id'] = String(user.uid);
      } else if (user.id) {
        headers['x-user-id'] = String(user.id);
      }
      
      // Always send email - backend will prioritize email lookup for better reliability
      if (user.email) {
        headers['x-user-email'] = user.email;
      }
      
      if (__DEV__) {
        console.log('[ReportService] Sending user headers:', {
          'x-user-id': headers['x-user-id'],
          'x-user-email': headers['x-user-email'],
          userRole: user.role,
          userUid: user.uid,
          userId: user.id,
        });
      }
    } else {
      if (__DEV__) {
        console.warn('[ReportService] No user object provided - report generation may fail');
      }
    }

    const url = `${API_GATEWAY_URL}/api/reports/generate`;
    if (__DEV__) {
      console.log('[ReportService] Requesting report generation:', {
        url,
        range,
        from,
        to,
        hasUser: !!user,
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(`${API_GATEWAY_URL}/api/reports/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        range,
        from,
        to,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Try to parse error response
      let errorMessage = 'Failed to generate report';
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
        
        // Provide more specific error messages
        if (response.status === 401 || response.status === 403) {
          errorMessage = 'Permission denied. Only super admins can generate reports.';
        } else if (response.status === 503) {
          errorMessage = 'Reporting service is unavailable. Please try again later.';
        } else if (response.status === 400) {
          errorMessage = errorData.message || 'Invalid request. Please check your date range.';
        }
      } catch (parseError) {
        // If response is not JSON, use status text
        errorMessage = response.statusText || `Server error (${response.status})`;
        if (__DEV__) {
          console.warn('[ReportService] Could not parse error response:', parseError);
        }
      }
      
      if (__DEV__) {
        console.error('[ReportService] API error:', {
          status: response.status,
          statusText: response.statusText,
          message: errorMessage,
        });
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (__DEV__) {
      console.log('[ReportService] Report generation started successfully:', data);
    }
    
    return data;
  } catch (error) {
    console.error('[ReportService] Error generating report:', error);
    
    // Handle specific error types
    if (error.name === 'AbortError') {
      throw new Error('Request timeout. The server took too long to respond. Please try again.');
    }
    
    // Handle network errors (fetch fails before response)
    if (error.message?.includes('Network request failed') || 
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('NetworkError') ||
        error.message?.includes('TypeError')) {
      throw new Error('Network error. Please check your internet connection and try again.');
    }
    
    // If error already has a message (from our error handling above), use it
    if (error.message && error.message !== 'Failed to generate report') {
      throw error;
    }
    
    // Generic fallback
    throw new Error(error.message || 'Failed to generate report. Please check your connection and try again.');
  }
}

/**
 * Download a generated report
 * @param {string} reportId - Report ID from generate response
 * @param {Object} user - User object for authentication
 * @returns {Promise<{success: boolean, fileUri?: string, error?: string}>} Download result
 */
export async function downloadReport(reportId, user = null) {
  try {
    // Validate API Gateway URL
    if (!API_GATEWAY_URL || API_GATEWAY_URL.includes('localhost') || API_GATEWAY_URL.includes('undefined')) {
      throw new Error('API Gateway is not configured. Please check your app configuration.');
    }

    const headers = {};

    // Add authentication headers if user is available
    if (user) {
      if (user.uid) {
        headers['x-user-id'] = String(user.uid);
      } else if (user.id) {
        headers['x-user-id'] = String(user.id);
      }
      if (user.email) {
        headers['x-user-email'] = user.email;
      }
    }

    const url = `${API_GATEWAY_URL}/api/reports/download/${reportId}`;
    
    if (__DEV__) {
      console.log('[ReportService] Downloading report:', { url, reportId });
    }

    // Download file to local storage
    // Use legacy API's documentDirectory (same pattern as export.js)
    const documentDir = FileSystemLegacy.documentDirectory || FileSystem.documentDirectory;
    if (!documentDir) {
      throw new Error('Document directory is not available. Please ensure expo-file-system is properly configured.');
    }
    const fileUri = documentDir + `report-${reportId}.pdf`;
    
    if (__DEV__) {
      console.log('[ReportService] Downloading to:', fileUri);
    }
    
    // Use legacy API for downloadAsync (deprecated in v54, but still functional)
    const downloadResult = await FileSystemLegacy.downloadAsync(url, fileUri, {
      headers,
    });

    if (downloadResult.status !== 200) {
      throw new Error(`Download failed with status ${downloadResult.status}`);
    }

    if (__DEV__) {
      console.log('[ReportService] Report downloaded successfully:', fileUri);
    }

    return {
      success: true,
      fileUri: downloadResult.uri,
    };
  } catch (error) {
    console.error('[ReportService] Error downloading report:', error);
    
    // Handle specific error types
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      throw new Error('Report not found or has expired. Reports are retained for 7 days.');
    }
    
    if (error.message?.includes('Network') || error.message?.includes('fetch')) {
      throw new Error('Network error. Please check your internet connection and try again.');
    }
    
    throw new Error(error.message || 'Failed to download report. Please try again.');
  }
}

/**
 * Open a downloaded report file
 * @param {string} fileUri - Local file URI
 * @returns {Promise<{success: boolean, error?: string}>} Open result
 */
export async function openReport(fileUri) {
  try {
    // For Android, use content URI
    if (Platform.OS === 'android') {
      // Use legacy API for getContentUriAsync
      const contentUri = await FileSystemLegacy.getContentUriAsync(fileUri);
      const canOpen = await Linking.canOpenURL(contentUri);
      
      if (canOpen) {
        await Linking.openURL(contentUri);
        return { success: true };
      } else {
        throw new Error('No app available to open PDF files');
      }
    } else {
      // For iOS, use file URI directly
      const canOpen = await Linking.canOpenURL(fileUri);
      
      if (canOpen) {
        await Linking.openURL(fileUri);
        return { success: true };
      } else {
        throw new Error('No app available to open PDF files');
      }
    }
  } catch (error) {
    console.error('[ReportService] Error opening report:', error);
    throw new Error(error.message || 'Failed to open report. The file has been saved to your device.');
  }
}

