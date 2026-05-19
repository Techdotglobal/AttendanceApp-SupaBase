// Ticket Management Utilities using Supabase
import { supabase } from '../core/config/supabase';
import { createNotification, createBatchNotifications } from './notifications';
import { getAdminUsers, getSuperAdminUsers, getManagersByDepartment } from './employees';
import { fetchSessionUserCompanyId } from '../core/tenant/tenantScope';

// Ticket Categories
export const TICKET_CATEGORIES = {
  ENGINEERING: 'engineering',
  TECHNICAL: 'technical',
  HR: 'hr',
  FINANCE: 'finance',
  SALES: 'sales',
  FACILITIES: 'facilities',
  OTHER: 'other'
};

// Map ticket categories to departments
// Engineering and Technical are separate departments
export const CATEGORY_TO_DEPARTMENT_MAP = {
  [TICKET_CATEGORIES.ENGINEERING]: 'Engineering', // Routes to Engineering Manager
  [TICKET_CATEGORIES.TECHNICAL]: 'Technical',     // Routes to Technical Manager (separate department)
  [TICKET_CATEGORIES.HR]: 'HR',
  [TICKET_CATEGORIES.FINANCE]: 'Finance',
  [TICKET_CATEGORIES.SALES]: 'Sales',
  [TICKET_CATEGORIES.FACILITIES]: 'Facilities',
  [TICKET_CATEGORIES.OTHER]: null // No specific department, goes to super_admin only
};

// Ticket Priorities
export const TICKET_PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
};

// Ticket Status
export const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

// Category Labels
export const getCategoryLabel = (category) => {
  const labels = {
    [TICKET_CATEGORIES.ENGINEERING]: 'Engineering',
    [TICKET_CATEGORIES.TECHNICAL]: 'Technical',
    [TICKET_CATEGORIES.HR]: 'HR',
    [TICKET_CATEGORIES.FINANCE]: 'Finance',
    [TICKET_CATEGORIES.SALES]: 'Sales',
    [TICKET_CATEGORIES.FACILITIES]: 'Facilities',
    [TICKET_CATEGORIES.OTHER]: 'Other'
  };
  return labels[category] || category;
};

// Priority Labels
export const getPriorityLabel = (priority) => {
  const labels = {
    [TICKET_PRIORITIES.LOW]: 'Low',
    [TICKET_PRIORITIES.MEDIUM]: 'Medium',
    [TICKET_PRIORITIES.HIGH]: 'High',
    [TICKET_PRIORITIES.URGENT]: 'Urgent'
  };
  return labels[priority] || priority;
};

// Status Labels
export const getStatusLabel = (status) => {
  const labels = {
    [TICKET_STATUS.OPEN]: 'Open',
    [TICKET_STATUS.IN_PROGRESS]: 'In Progress',
    [TICKET_STATUS.RESOLVED]: 'Resolved',
    [TICKET_STATUS.CLOSED]: 'Closed'
  };
  return labels[status] || status;
};

// Priority Colors
export const getPriorityColor = (priority) => {
  const colors = {
    [TICKET_PRIORITIES.LOW]: '#10b981', // Green
    [TICKET_PRIORITIES.MEDIUM]: '#3b82f6', // Blue
    [TICKET_PRIORITIES.HIGH]: '#f59e0b', // Amber
    [TICKET_PRIORITIES.URGENT]: '#ef4444' // Red
  };
  return colors[priority] || '#6b7280';
};

// Status Colors
export const getStatusColor = (status) => {
  const colors = {
    [TICKET_STATUS.OPEN]: '#3b82f6', // Blue
    [TICKET_STATUS.IN_PROGRESS]: '#f59e0b', // Amber
    [TICKET_STATUS.RESOLVED]: '#10b981', // Green
    [TICKET_STATUS.CLOSED]: '#6b7280' // Gray
  };
  return colors[status] || '#6b7280';
};


/**
 * Convert database ticket format to app format
 * @param {Object} dbTicket - Ticket from database
 * @returns {Object} Ticket in app format
 */
const convertTicketFromDb = (dbTicket) => {
  return {
    id: dbTicket.id,
    createdBy: dbTicket.created_by,
    category: dbTicket.category,
    priority: dbTicket.priority,
    subject: dbTicket.subject,
    description: dbTicket.description,
    status: dbTicket.status,
    assignedTo: dbTicket.assigned_to,
    createdAt: dbTicket.created_at,
    updatedAt: dbTicket.updated_at,
    resolvedAt: dbTicket.resolved_at,
    closedAt: dbTicket.closed_at,
    responses: dbTicket.responses || []
  };
};

/**
 * Create a new ticket
 * @param {string} createdBy - Username of the person creating the ticket
 * @param {string} category - Ticket category
 * @param {string} priority - Ticket priority
 * @param {string} subject - Ticket subject
 * @param {string} description - Ticket description
 * @returns {Promise<{success: boolean, ticketId?: string, error?: string}>}
 */
export const createTicket = async (createdBy, category, priority, subject, description) => {
  try {
    // Validate category
    if (!Object.values(TICKET_CATEGORIES).includes(category)) {
      return {
        success: false,
        error: 'Invalid ticket category'
      };
    }

    // Validate priority
    if (!Object.values(TICKET_PRIORITIES).includes(priority)) {
      return {
        success: false,
        error: 'Invalid ticket priority'
      };
    }

    if (!subject.trim() || !description.trim()) {
      return {
        success: false,
        error: 'Subject and description are required'
      };
    }

    // Get user UID for database reference
    // MUST use auth.uid() from current Supabase session for RLS policy to work
    // RLS policy requires: created_by_uid = auth.uid()
    let createdByUid = null;
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) {
        console.error('Error getting Supabase session:', authError);
        return {
          success: false,
          error: 'Unable to verify user session. Please log in again.'
        };
      }
      
      if (authUser && authUser.id) {
        createdByUid = authUser.id;
        console.log('✓ Using UID from current Supabase session (auth.uid()):', createdByUid);
      } else {
        // No active session
        console.error('No active Supabase session found');
        return {
          success: false,
          error: 'Please ensure you are logged in. Session not found.'
        };
      }
    } catch (error) {
      console.error('Error getting Supabase session:', error);
      return {
        success: false,
        error: 'Unable to verify user session. Please log in again.'
      };
    }

    // If still no UID, we cannot proceed (RLS requires it)
    if (!createdByUid) {
      console.error('Cannot create ticket: created_by_uid is required for RLS policy');
      return {
        success: false,
        error: 'Unable to verify user identity. Please ensure you are logged in correctly.'
      };
    }

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      return { success: false, error: 'Tenant context missing. Please sign in again.' };
    }

    // Auto-assign to department manager based on category
    let assignedManager = null;
    const department = CATEGORY_TO_DEPARTMENT_MAP[category];
    let initialStatus = TICKET_STATUS.OPEN;
    
    console.log(`[Ticket Routing] Category: ${category}, Department: ${department || 'N/A'}`);
    
    if (department) {
      try {
        console.log(`[Ticket Routing] Looking for managers in department: ${department}`);
        const departmentManagers = await getManagersByDepartment(department, tenantCid);
        console.log(`[Ticket Routing] Found ${departmentManagers.length} manager(s) for ${department}:`, 
          departmentManagers.map(m => m.username));
        
        if (departmentManagers.length > 0) {
          // Direct routing: Each category maps to its own department
          // - "technical" category → Technical department → Technical Manager
          assignedManager = departmentManagers[0];
          initialStatus = TICKET_STATUS.IN_PROGRESS;
          console.log(`✓ Ticket (${category}) will be assigned to ${assignedManager.username} (${assignedManager.position || department} Manager)`);
        } else {
          console.warn(`⚠️ No manager found for department: ${department}. Ticket will not be auto-assigned.`);
          // Fallback: Try to assign to a super_admin if no manager found
          try {
            const superAdmins = await getSuperAdminUsers(tenantCid);
            if (superAdmins.length > 0) {
              assignedManager = superAdmins[0];
              console.log(`✓ Fallback: Assigning ticket to super_admin: ${assignedManager.username}`);
            }
          } catch (fallbackError) {
            console.error('Error getting super_admin for fallback assignment:', fallbackError);
          }
        }
      } catch (error) {
        console.error('Error finding department manager:', error);
        // Fallback: Try to assign to a super_admin on error
        try {
          const superAdmins = await getSuperAdminUsers(tenantCid);
          if (superAdmins.length > 0) {
            assignedManager = superAdmins[0];
            console.log(`✓ Fallback (on error): Assigning ticket to super_admin: ${assignedManager.username}`);
          }
        } catch (fallbackError) {
          console.error('Error getting super_admin for fallback assignment:', fallbackError);
        }
      }
    } else {
      console.log(`[Ticket Routing] No department mapping for category: ${category}. Assigning to super_admin.`);
      // For "other" category or unmapped categories, assign to super_admin
      try {
        const superAdmins = await getSuperAdminUsers(tenantCid);
        if (superAdmins.length > 0) {
          assignedManager = superAdmins[0];
          console.log(`✓ Assigning ticket to super_admin: ${assignedManager.username}`);
        }
      } catch (fallbackError) {
        console.error('Error getting super_admin for assignment:', fallbackError);
      }
    }
    
    if (assignedManager) {
      console.log(`✓ Final assignment: ${assignedManager.username} (${assignedManager.role}, ${assignedManager.department || 'N/A'})`);
    } else {
      console.warn(`⚠️ WARNING: Ticket will be created with assigned_to = null`);
    }

    // Create ticket in Supabase
    const ticketData = {
      created_by_uid: createdByUid,
      company_id: tenantCid,
      created_by: createdBy,
      category: category,
      priority: priority,
      subject: subject.trim(),
      description: description.trim(),
      status: initialStatus,
      assigned_to: assignedManager?.username || null,
      resolved_at: null,
      closed_at: null,
      responses: []
    };

    const { data: insertedTicket, error: insertError } = await supabase
      .from('tickets')
      .insert(ticketData)
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting ticket to Supabase:', insertError);
      return {
        success: false,
        error: insertError.message || 'Failed to create ticket in database'
      };
    }

    const ticketId = insertedTicket.id;

    // CRITICAL: Create notifications using centralized helper with guaranteed persistence
    // This ensures ALL notifications are created and stored correctly
    
    // 1. Notify super admins (always notified of all tickets)
    try {
      const superAdmins = await getSuperAdminUsers(tenantCid);
      if (superAdmins && superAdmins.length > 0) {
        const superAdminUsernames = superAdmins
          .map(admin => admin.username)
          .filter(username => username); // Filter out any null/undefined usernames
        
        if (superAdminUsernames.length > 0) {
          const notificationTitle = 'New Ticket Created';
          const notificationBody = `${createdBy} created a ${getPriorityLabel(priority)} priority ${getCategoryLabel(category)} ticket: ${subject}${assignedManager ? ` (Assigned to ${assignedManager.name})` : ''}`;
          
          const notificationData = {
            ticketId,
            createdBy,
            category,
            priority,
            subject,
            assignedTo: assignedManager?.username || null,
          };
          
          // Use batch notification creation for efficiency and reliability
          // Note: All notifications in batch share the same data structure
          // Individual navigation params are set per notification in the data
          const batchResult = await createBatchNotifications(
            superAdminUsernames,
            notificationTitle,
            notificationBody,
            'ticket_created',
            {
              ...notificationData,
              // Navigation data - will be handled by centralized navigation handler
              navigation: {
                screen: 'HRDashboard', // Use HR Dashboard for ticket management
                params: {
                  ticketId: ticketId,
                  // User will be added by navigation handler
                }
              }
            }
          );
          
          if (__DEV__) {
            console.log(`[Ticket] Notified ${batchResult.created} super admin(s), ${batchResult.failed} failed`);
          }
        } else {
          if (__DEV__) {
            console.warn('[Ticket] No valid super admin usernames found for notification');
          }
        }
      }
    } catch (notifError) {
      console.error('[Ticket] CRITICAL: Error notifying super admins:', notifError);
      // Continue - ticket was created successfully, notification failure is logged
    }

    // 2. Notify assigned department manager (if assigned)
    if (assignedManager && assignedManager.username) {
      try {
        const notificationTitle = 'Ticket Assigned to You';
        const notificationBody = `A ${getPriorityLabel(priority)} priority ${getCategoryLabel(category)} ticket has been assigned to you: ${subject}`;
        
        const result = await createNotification(
          assignedManager.username,
          notificationTitle,
          notificationBody,
          'ticket_assigned',
          {
            ticketId,
            createdBy,
            category,
            priority,
            subject,
            navigation: {
              screen: 'HRDashboard', // Use HR Dashboard for ticket management
              params: {
                ticketId: ticketId,
                // User will be added by navigation handler
              }
            }
          }
        );
        
        if (result.success) {
          if (__DEV__) {
            console.log(`[Ticket] ✓ Notification sent to assigned manager: ${assignedManager.username}`);
          }
        } else {
          console.error(`[Ticket] Failed to notify assigned manager ${assignedManager.username}:`, result.error);
        }
      } catch (notifError) {
        console.error('[Ticket] CRITICAL: Error notifying assigned manager:', notifError);
        // Continue - ticket was created successfully
      }
    } else {
      // 3. If no manager found, notify all managers about unassigned ticket
      try {
        const allManagers = await getAdminUsers(tenantCid);
        const managers = allManagers.filter(admin => admin.role === 'manager' && admin.username);
        
        if (managers && managers.length > 0) {
          const managerUsernames = managers.map(m => m.username).filter(u => u);
          
          if (managerUsernames.length > 0) {
            const notificationTitle = 'New Unassigned Ticket';
            const notificationBody = `${createdBy} created a ${getPriorityLabel(priority)} priority ${getCategoryLabel(category)} ticket (needs assignment): ${subject}`;
            
            const batchResult = await createBatchNotifications(
              managerUsernames,
              notificationTitle,
              notificationBody,
              'ticket_created',
              {
                ticketId,
                createdBy,
                category,
                priority,
                subject,
                navigation: {
                  screen: 'TicketManagement',
                  params: {
                    ticketId: ticketId
                  }
                }
              }
            );
            
            if (__DEV__) {
              console.log(`[Ticket] Notified ${batchResult.created} manager(s) about unassigned ticket, ${batchResult.failed} failed`);
            }
          }
        }
      } catch (notifError) {
        console.error('[Ticket] CRITICAL: Error notifying managers about unassigned ticket:', notifError);
        // Continue - ticket was created successfully
      }
    }

    console.log(`Ticket created: ${ticketId}`);
    return {
      success: true,
      ticketId: ticketId
    };
  } catch (error) {
    console.error('Error creating ticket:', error);
    return {
      success: false,
      error: error.message || 'Failed to create ticket'
    };
  }
};

/**
 * Get all tickets for a user (created by them)
 * @param {string} username - Username
 * @returns {Promise<Array>} Array of tickets
 */
export const getUserTickets = async (username) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) return [];

    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('company_id', tenantCid)
      .eq('created_by', username)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting user tickets from Supabase:', error);
      return [];
    }

    return tickets.map(convertTicketFromDb);
  } catch (error) {
    console.error('Error getting user tickets:', error);
    return [];
  }
};

/**
 * Get all tickets (for admin)
 * @returns {Promise<Array>} Array of all tickets
 */
export const getAllTickets = async () => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      console.warn('[tenant] getAllTickets: no company_id');
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getAllTickets', { queried_company_id: tenantCid });
    }

    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('company_id', tenantCid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting tickets from Supabase:', error);
      return [];
    }

    return tickets.map(convertTicketFromDb);
  } catch (error) {
    console.error('Error getting all tickets:', error);
    return [];
  }
};

/**
 * Get ticket by ID
 * @param {string} ticketId - Ticket ID
 * @returns {Promise<Object|null>} Ticket object or null
 */
export const getTicketById = async (ticketId) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) return null;

    const { data: ticket, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('company_id', tenantCid)
      .single();

    if (error || !ticket) {
      console.error('Error getting ticket by ID from Supabase:', error);
      return null;
    }

    return convertTicketFromDb(ticket);
  } catch (error) {
    console.error('Error getting ticket by ID:', error);
    return null;
  }
};

/**
 * Update ticket status
 * @param {string} ticketId - Ticket ID
 * @param {string} status - New status
 * @param {string} updatedBy - Username who updated
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateTicketStatus = async (ticketId, status, updatedBy) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) return { success: false, error: 'Tenant context missing. Please sign in again.' };

    if (!Object.values(TICKET_STATUS).includes(status)) {
      return {
        success: false,
        error: 'Invalid ticket status'
      };
    }

    // Get the ticket from Supabase first
    const { data: ticket, error: fetchError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('company_id', tenantCid)
      .single();

    if (fetchError || !ticket) {
      return {
        success: false,
        error: 'Ticket not found'
      };
    }

    // Prepare update data
    const updateData = {
      status: status
    };

    if (status === TICKET_STATUS.RESOLVED) {
      updateData.resolved_at = new Date().toISOString();
    } else if (status === TICKET_STATUS.CLOSED) {
      updateData.closed_at = new Date().toISOString();
    }

    // Update ticket in Supabase
    const { error: updateError } = await supabase
      .from('tickets')
      .update(updateData)
      .eq('id', ticketId)
      .eq('company_id', tenantCid);

    if (updateError) {
      console.error('Error updating ticket status in Supabase:', updateError);
      return {
        success: false,
        error: updateError.message || 'Failed to update ticket status'
      };
    }

    // Send notification to ticket creator
    try {
      const notificationTitle = 'Ticket Status Updated';
      const notificationBody = `Your ticket "${ticket.subject}" has been ${getStatusLabel(status).toLowerCase()}`;
      
      await createNotification(
        ticket.created_by,
        notificationTitle,
        notificationBody,
        'ticket_updated',
        {
          ticketId,
          status,
          subject: ticket.subject,
          // Navigation data
          navigation: {
            screen: 'TicketScreen',
            params: {
              user: { username: ticket.created_by },
              ticketId: ticketId
            }
          }
        }
      );
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating ticket status:', error);
    return {
      success: false,
      error: error.message || 'Failed to update ticket status'
    };
  }
};

/**
 * Assign ticket to admin
 * @param {string} ticketId - Ticket ID
 * @param {string} assignedTo - Username of admin to assign to
 * @param {string} assignedBy - Username who assigned
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const assignTicket = async (ticketId, assignedTo, assignedBy) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) return { success: false, error: 'Tenant context missing. Please sign in again.' };

    // Get the ticket from Supabase first
    const { data: ticket, error: fetchError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('company_id', tenantCid)
      .single();

    if (fetchError || !ticket) {
      return {
        success: false,
        error: 'Ticket not found'
      };
    }

    // Prepare update data
    const updateData = {
      assigned_to: assignedTo
    };

    // If status is open, change to in progress
    if (ticket.status === TICKET_STATUS.OPEN) {
      updateData.status = TICKET_STATUS.IN_PROGRESS;
    }

    // Update ticket in Supabase and return updated data
    const { data: updatedTicket, error: updateError } = await supabase
      .from('tickets')
      .update(updateData)
      .eq('id', ticketId)
      .eq('company_id', tenantCid)
      .select('id, created_by_uid, created_by, category, priority, subject, description, status, assigned_to, created_at, updated_at, resolved_at, closed_at, responses')
      .single();

    if (updateError) {
      console.error('Error assigning ticket in Supabase:', updateError);
      // Check if it's a permission error (RLS policy violation)
      if (updateError.code === '42501' || updateError.message?.includes('permission') || updateError.message?.includes('policy')) {
        return {
          success: false,
          error: 'Permission denied: You do not have permission to reassign this ticket'
        };
      }
      return {
        success: false,
        error: updateError.message || 'Failed to assign ticket'
      };
    }

    if (!updatedTicket) {
      return {
        success: false,
        error: 'Update succeeded but no data returned'
      };
    }

    // CRITICAL: Send notification to assigned admin using centralized helper
    if (assignedTo) {
      try {
        const notificationTitle = 'Ticket Assigned';
        const notificationBody = `You have been assigned a ${getPriorityLabel(ticket.priority)} priority ticket: ${ticket.subject}`;
        
        const result = await createNotification(
          assignedTo,
          notificationTitle,
          notificationBody,
          'ticket_assigned',
          {
            ticketId,
            priority: ticket.priority,
            subject: ticket.subject,
            navigation: {
              screen: 'TicketManagement',
              params: {
                user: { username: assignedTo },
                ticketId: ticketId
              }
            }
          }
        );
        
        if (result.success) {
          if (__DEV__) {
            console.log(`[Ticket] ✓ Notification sent to assigned user: ${assignedTo}`);
          }
        } else {
          console.error(`[Ticket] Failed to notify assigned user ${assignedTo}:`, result.error);
        }
      } catch (notifError) {
        console.error('[Ticket] CRITICAL: Error sending assignment notification:', notifError);
        // Continue - ticket was assigned successfully
      }
    }

    // Convert Supabase format to app format
    const formattedTicket = {
      id: updatedTicket.id,
      createdBy: updatedTicket.created_by,
      createdByUid: updatedTicket.created_by_uid,
      category: updatedTicket.category,
      priority: updatedTicket.priority,
      subject: updatedTicket.subject,
      description: updatedTicket.description,
      status: updatedTicket.status,
      assignedTo: updatedTicket.assigned_to,
      createdAt: updatedTicket.created_at,
      updatedAt: updatedTicket.updated_at,
      resolvedAt: updatedTicket.resolved_at,
      closedAt: updatedTicket.closed_at,
      responses: updatedTicket.responses || []
    };

    return { 
      success: true, 
      data: formattedTicket 
    };
  } catch (error) {
    console.error('Error assigning ticket:', error);
    return {
      success: false,
      error: error.message || 'Failed to assign ticket'
    };
  }
};

/**
 * Add response to ticket
 * @param {string} ticketId - Ticket ID
 * @param {string} respondedBy - Username who responded
 * @param {string} message - Response message
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const addTicketResponse = async (ticketId, respondedBy, message) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) return { success: false, error: 'Tenant context missing. Please sign in again.' };

    if (!message.trim()) {
      return {
        success: false,
        error: 'Response message is required'
      };
    }

    // Get the ticket from Supabase first
    const { data: ticket, error: fetchError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('company_id', tenantCid)
      .single();

    if (fetchError || !ticket) {
      return {
        success: false,
        error: 'Ticket not found'
      };
    }

    // Create new response
    const response = {
      id: `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      respondedBy,
      message: message.trim(),
      createdAt: new Date().toISOString()
    };

    // Get existing responses and add new one
    const existingResponses = ticket.responses || [];
    const updatedResponses = [...existingResponses, response];

    // Update ticket in Supabase
    const { error: updateError } = await supabase
      .from('tickets')
      .update({
        responses: updatedResponses
      })
      .eq('id', ticketId)
      .eq('company_id', tenantCid);

    if (updateError) {
      console.error('Error adding ticket response in Supabase:', updateError);
      return {
        success: false,
        error: updateError.message || 'Failed to add response'
      };
    }

    // CRITICAL: Send notifications using centralized helper
    try {
      const notificationTitle = 'New Response on Ticket';
      const notificationBody = `${respondedBy} responded to ticket: ${ticket.subject}`;
      
      const recipients = [];
      
      // Notify ticket creator if not the one responding
      if (ticket.created_by && respondedBy !== ticket.created_by) {
        recipients.push(ticket.created_by);
      }

      // Notify assigned admin if different from responder and creator
      if (ticket.assigned_to && 
          ticket.assigned_to !== respondedBy && 
          ticket.assigned_to !== ticket.created_by &&
          !recipients.includes(ticket.assigned_to)) {
        recipients.push(ticket.assigned_to);
      }
      
      // Create notifications for all recipients
      if (recipients.length > 0) {
        const notificationData = {
          ticketId,
          subject: ticket.subject,
          respondedBy,
          navigation: {
            screen: 'HRDashboard', // Use HR Dashboard for ticket management
            params: {
              ticketId: ticketId
            }
          }
        };
        
        const batchResult = await createBatchNotifications(
          recipients,
          notificationTitle,
          notificationBody,
          'ticket_response',
          notificationData
        );
        
        if (__DEV__) {
          console.log(`[Ticket] Notified ${batchResult.created} recipient(s) about response, ${batchResult.failed} failed`);
        }
      }
    } catch (notifError) {
      console.error('[Ticket] CRITICAL: Error sending response notifications:', notifError);
      // Continue - response was added successfully
    }

    return { success: true };
  } catch (error) {
    console.error('Error adding ticket response:', error);
    return {
      success: false,
      error: error.message || 'Failed to add response'
    };
  }
};

/**
 * Get tickets by status
 * @param {string} status - Ticket status
 * @returns {Promise<Array>} Array of tickets with the specified status
 */
export const getTicketsByStatus = async (status) => {
  try {
    const allTickets = await getAllTickets();
    return allTickets.filter(ticket => ticket.status === status);
  } catch (error) {
    console.error('Error getting tickets by status:', error);
    return [];
  }
};

/**
 * Get tickets by category
 * @param {string} category - Ticket category
 * @returns {Promise<Array>} Array of tickets with the specified category
 */
export const getTicketsByCategory = async (category) => {
  try {
    const allTickets = await getAllTickets();
    return allTickets.filter(ticket => ticket.category === category);
  } catch (error) {
    console.error('Error getting tickets by category:', error);
    return [];
  }
};

/**
 * Get tickets assigned to a user
 * @param {string} username - Username
 * @returns {Promise<Array>} Array of tickets assigned to the user
 */
export const getAssignedTickets = async (username) => {
  try {
    const allTickets = await getAllTickets();
    return allTickets.filter(ticket => ticket.assignedTo === username);
  } catch (error) {
    console.error('Error getting assigned tickets:', error);
    return [];
  }
};
