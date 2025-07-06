import { useState, useEffect, useCallback } from "react";
import { Notification } from "@/types";
import { notificationService, subscribeToUserNotifications } from "@/services/firebase";

export const useNotificationStore = (userId?: string) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const userNotifications = await notificationService.getNotifications(userId);
      setNotifications(Array.isArray(userNotifications) ? userNotifications : []);
    } catch (err) {
      console.error("Error loading notifications:", err);
      setError(err instanceof Error ? err.message : "Failed to load notifications");
      setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Set up real-time listener for notifications
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    console.log("Setting up notifications listener for user:", userId);
    setIsLoading(true);
    setError(null);

    let unsubscribe: () => void = () => {};

    // Set up the real-time listener
    const setupListener = () => {
      try {
        unsubscribe = subscribeToUserNotifications(
          userId,
          (userNotifications) => {
            try {
              console.log("Notifications received:", userNotifications.length);
              
              // Ensure we always set an array
              const safeNotifications = Array.isArray(userNotifications) ? userNotifications : [];
              
              // Process notifications to ensure proper format
              const processedNotifications = safeNotifications.map(notification => {
                // Ensure required fields exist
                if (!notification.id || !notification.userId || !notification.type) {
                  console.warn("Incomplete notification data:", notification);
                  return null;
                }

                // Ensure createdAt is a string
                let createdAt = notification.createdAt;
                if (!createdAt) {
                  createdAt = new Date().toISOString();
                }

                return {
                  ...notification,
                  createdAt,
                  read: Boolean(notification.read),
                  message: notification.message || '',
                  data: notification.data || undefined
                };
              }).filter(Boolean) as Notification[];
              
              setNotifications(processedNotifications);
              setIsLoading(false);
              setError(null);
            } catch (processError) {
              console.error("Error processing notifications:", processError);
              setError("Error processing notifications");
              setNotifications([]);
              setIsLoading(false);
            }
          }
        );
      } catch (setupError) {
        console.error("Error setting up notifications listener:", setupError);
        setError("Failed to set up notifications listener");
        setIsLoading(false);
        
        // Fallback to one-time load
        loadNotifications();
      }
    };

    // Call the setup function
    setupListener();

    // Cleanup function
    return () => {
      console.log("Cleaning up notifications listener");
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (cleanupError) {
          console.error("Error during notifications listener cleanup:", cleanupError);
        }
      }
    };
  }, [userId, loadNotifications]);

  const markAsRead = async (notificationId: string): Promise<void> => {
    try {
      await notificationService.markAsRead(notificationId);
      // Optimistic update
      setNotifications((prev) =>
        Array.isArray(prev) ? prev.map((notification) =>
          notification.id === notificationId
            ? { ...notification, read: true }
            : notification,
        ) : []
      );
    } catch (err) {
      console.error("Error marking notification as read:", err);
      setError(err instanceof Error ? err.message : "Failed to mark notification as read");
      throw err;
    }
  };

  const markAllAsRead = async (): Promise<void> => {
    if (!userId) return;

    try {
      const unreadNotifications = Array.isArray(notifications)
        ? notifications.filter((n) => !n.read)
        : [];
        
      await Promise.all(
        unreadNotifications.map((notification) =>
          notificationService.markAsRead(notification.id)
        )
      );

      // Optimistic update
      setNotifications((prev) =>
        Array.isArray(prev) ? prev.map((notification) => ({ ...notification, read: true })) : []
      );
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
      setError(err instanceof Error ? err.message : "Failed to mark all notifications as read");
      throw err;
    }
  };

  const getUnreadCount = (): number => {
    if (!Array.isArray(notifications)) return 0;
    return notifications.filter((notification) => !notification.read).length;
  };

  const getNotificationsByType = (
    type: Notification["type"],
  ): Notification[] => {
    if (!Array.isArray(notifications)) return [];
    return notifications.filter((notification) => notification.type === type);
  };

  const deleteNotification = async (notificationId: string): Promise<void> => {
    try {
      await notificationService.deleteNotification(notificationId);
      // Optimistic update
      setNotifications((prev) =>
        Array.isArray(prev) ? prev.filter((n) => n.id !== notificationId) : []
      );
    } catch (err) {
      console.error("Error deleting notification:", err);
      setError(err instanceof Error ? err.message : "Failed to delete notification");
      throw err;
    }
  };

  const clearAllNotifications = async (): Promise<void> => {
    if (!userId) return;

    try {
      await notificationService.clearAllNotifications(userId);
      // Optimistic update
      setNotifications([]);
    } catch (err) {
      console.error("Error clearing all notifications:", err);
      setError(err instanceof Error ? err.message : "Failed to clear all notifications");
      throw err;
    }
  };

  const createNotification = async (notification: Omit<Notification, "id" | "createdAt">): Promise<void> => {
    try {
      await notificationService.createNotification(notification);
      // Real-time listener will automatically update the state
    } catch (err) {
      console.error("Error creating notification:", err);
      setError(err instanceof Error ? err.message : "Failed to create notification");
      throw err;
    }
  };

  const refreshNotifications = async (): Promise<void> => {
    await loadNotifications();
  };

  const clearError = (): void => {
    setError(null);
  };

  return {
    notifications: Array.isArray(notifications) ? notifications : [],
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    getNotificationsByType,
    deleteNotification,
    clearAllNotifications,
    createNotification,
    loadNotifications: refreshNotifications,
    clearError,
  };
};
