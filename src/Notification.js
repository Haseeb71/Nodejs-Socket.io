// In-memory notification storage (no database)
const notifications = new Map(); // userId -> array of notifications

// Create a new notification
export const createNotification = (userId, type, message, data = {}) => {
    const notification = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        userId,
        type,
        message,
        data,
        timestamp: new Date().toISOString(),
        read: false
    };

    if (!notifications.has(userId)) {
        notifications.set(userId, []);
    }

    notifications.get(userId).push(notification);
    console.log(`📢 Created notification for user ${userId}:`, notification);
    return notification;
};

// Create broadcast notification (without specific user ID)
export const createBroadcastNotification = (type, message, data = {}) => {
    const notification = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        userId: 'broadcast',
        type,
        message,
        data,
        timestamp: new Date().toISOString(),
        read: false
    };

    // Add to all existing users in the notifications map
    for (const [userId] of notifications.entries()) {
        notifications.get(userId).push({ ...notification, userId });
    }

    console.log(`📢 Created broadcast notification:`, notification);
    return notification;
};

// Get all notifications for a user
export const getUserNotifications = (userId) => {
    return notifications.get(userId) || [];
};

// Get unread notification count for a user
export const getUnreadNotificationCount = (userId) => {
    const userNotifications = notifications.get(userId) || [];
    return userNotifications.filter(notification => !notification.read).length;
};

// Mark notification as read
export const markNotificationAsRead = (userId, notificationId) => {
    const userNotifications = notifications.get(userId) || [];
    const notification = userNotifications.find(n => n.id === notificationId);
    
    if (notification) {
        notification.read = true;
        console.log(`📖 Marked notification ${notificationId} as read for user ${userId}`);
        return true;
    }
    
    return false;
};

// Mark all notifications as read for a user
export const markAllNotificationsAsRead = (userId) => {
    const userNotifications = notifications.get(userId) || [];
    userNotifications.forEach(notification => {
        notification.read = true;
    });
    
    console.log(`📖 Marked all notifications as read for user ${userId}`);
    return userNotifications.length;
};

// Get notifications with read/unread breakdown
export const getUserNotificationsWithStatus = (userId) => {
    const userNotifications = notifications.get(userId) || [];
    const unread = userNotifications.filter(n => !n.read);
    const read = userNotifications.filter(n => n.read);
    
    return {
        all: userNotifications,
        unread,
        read,
        unreadCount: unread.length,
        readCount: read.length,
        totalCount: userNotifications.length
    };
};
