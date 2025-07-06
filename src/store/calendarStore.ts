import { useState, useEffect, useCallback } from "react";
import {
  Event,
  HangoutEvent,
  CreateEventInput,
  User,
  HangoutMatch,
  Notification,
} from "@/types";
import {
  createEvent as createEventService,
  getUserEvents,
  updateEvent as updateEventService,
  deleteEvent as deleteEventService,
  getUserNotifications,
  createNotification,
  getUserFriends,
  getEventsByUserIds,
} from "@/services/firebase";

export const useCalendarStore = (userId?: string) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    if (!userId) {
      setEvents([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const userEvents = await getUserEvents(userId);
      setEvents(Array.isArray(userEvents) ? userEvents : []);
    } catch (err) {
      console.error('Error loading events:', err);
      setError('Failed to load events');
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const createEvent = async (eventData: CreateEventInput): Promise<Event | null> => {
    if (!userId) {
      setError("User ID is required");
      throw new Error("User ID is required");
    }

    try {
      setError(null);
      
      const newEvent: Omit<Event, 'id'> = {
        userId,
        title: eventData.title,
        description: eventData.description,
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        type: eventData.type,
        createdAt: new Date().toISOString(),
      };

      // Add hangout-specific properties
      if (eventData.type === "hangout" && eventData.preferences) {
        (newEvent as Omit<HangoutEvent, 'id'>).preferences = eventData.preferences;
        (newEvent as Omit<HangoutEvent, 'id'>).visibility = "friends";
      }

      const eventId = await createEventService(newEvent);
      if (!eventId) {
        throw new Error('Failed to create event');
      }

      const createdEvent = { ...newEvent, id: eventId };
      setEvents((prev) => [...(Array.isArray(prev) ? prev : []), createdEvent]);

      // Check for hangout matches if this is a hangout event
      if (createdEvent.type === "hangout") {
        checkForHangoutMatches(createdEvent as HangoutEvent);
      }

      return createdEvent;
    } catch (err) {
      console.error('Error creating event:', err);
      setError('Failed to create event');
      return null;
    }
  };

  const updateEvent = async (eventId: string, updates: Partial<Event>): Promise<boolean> => {
    try {
      setError(null);
      
      const safeEvents = Array.isArray(events) ? events : [];
      const event = safeEvents.find((e) => e.id === eventId);
      if (!event || event.userId !== userId) return false;

      const success = await updateEventService(eventId, updates);
      if (success) {
        const updatedEvent = { ...event, ...updates };
        setEvents((prev) =>
          Array.isArray(prev) ? prev.map((e) => (e.id === eventId ? updatedEvent : e)) : []
        );
      }

      return success;
    } catch (err) {
      console.error('Error updating event:', err);
      setError('Failed to update event');
      return false;
    }
  };

  const deleteEvent = async (eventId: string): Promise<boolean> => {
    try {
      setError(null);
      
      const safeEvents = Array.isArray(events) ? events : [];
      const event = safeEvents.find((e) => e.id === eventId);
      if (!event || event.userId !== userId) return false;

      const success = await updateEventService(eventId, {});
      if (success) {
        setEvents((prev) => Array.isArray(prev) ? prev.filter((e) => e.id !== eventId) : []);
      }

      return success;
    } catch (err) {
      console.error('Error deleting event:', err);
      setError('Failed to delete event');
      return false;
    }
  };

  const getFriendEvents = async (friendId: string): Promise<Event[]> => {
    try {
      const friendEvents = await getUserEvents(friendId);
      const safeEvents = Array.isArray(friendEvents) ? friendEvents : [];
      return safeEvents.filter(
        (event) => event.type === "hangout" || event.type === "personal"
      );
    } catch (error) {
      console.error('Error getting friend events:', error);
      return [];
    }
  };

  const getFriendHangouts = async (friendId: string): Promise<HangoutEvent[]> => {
    try {
      const friendEvents = await getUserEvents(friendId);
      const safeEvents = Array.isArray(friendEvents) ? friendEvents : [];
      return safeEvents.filter(
        (event) => event.type === "hangout"
      ) as HangoutEvent[];
    } catch (error) {
      console.error('Error getting friend hangouts:', error);
      return [];
    }
  };

  const checkForHangoutMatches = async (hangoutEvent: HangoutEvent) => {
    if (!userId) return;

    try {
      const friends = await getUserFriends(userId);
      if (!Array.isArray(friends) || friends.length === 0) return;

      const friendIds = friends.map(f => f.id);
      const allEvents = await getEventsByUserIds(friendIds);
      const safeAllEvents = Array.isArray(allEvents) ? allEvents : [];
      const friendHangouts = safeAllEvents.filter(
        (event) => event.type === "hangout"
      ) as HangoutEvent[];

      // Get existing notifications to avoid duplicates
      const existingNotifications = await getUserNotifications(userId);
      const safeNotifications = Array.isArray(existingNotifications) ? existingNotifications : [];

      for (const friend of friends) {
        const friendHangoutsForUser = Array.isArray(friendHangouts) ? friendHangouts.filter(
          (event) => event.userId === friend.id
        ) : [];

        for (const friendHangout of friendHangoutsForUser) {
          const overlap = getTimeOverlap(hangoutEvent, friendHangout);
          if (overlap) {
            // Check if notification already exists
            const alreadyNotified = safeNotifications.some(
              (notification) =>
                notification.type === "hangout_match" &&
                notification.data?.hangoutEvents?.includes(hangoutEvent.id) &&
                notification.data?.hangoutEvents?.includes(friendHangout.id)
            );

            if (!alreadyNotified) {
              await createHangoutMatch(hangoutEvent, friendHangout, overlap, friend);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking hangout matches:', error);
    }
  };

  const getTimeOverlap = (
    event1: Event,
    event2: Event,
  ): { start: string; end: string } | null => {
    try {
      const start1 = new Date(event1.startTime);
      const end1 = new Date(event1.endTime);
      const start2 = new Date(event2.startTime);
      const end2 = new Date(event2.endTime);

      const overlapStart = new Date(Math.max(start1.getTime(), start2.getTime()));
      const overlapEnd = new Date(Math.min(end1.getTime(), end2.getTime()));

      if (overlapStart <= overlapEnd) {
        return {
          start: overlapStart.toISOString(),
          end: overlapEnd.toISOString(),
        };
      }

      return null;
    } catch (error) {
      console.error('Error calculating time overlap:', error);
      return null;
    }
  };

  const createHangoutMatch = async (
    event1: HangoutEvent,
    event2: HangoutEvent,
    overlap: { start: string; end: string },
    otherUser: User
  ) => {
    try {
      const users = [event1.userId, event2.userId];

      // Create notifications for both users
      for (const notificationUserId of users) {
        const otherUserId = users.find((id) => id !== notificationUserId);

        const notification: Omit<Notification, 'id'> = {
          userId: notificationUserId,
          type: "hangout_match",
          title: "Hangout Match Found!",
          message: `You and ${otherUser.fullName} have overlapping hangout times`,
          data: {
            matchedUserId: otherUserId,
            overlappingTime: overlap,
            hangoutEvents: [event1.id, event2.id],
          },
          read: false,
          createdAt: new Date().toISOString(),
        };

        await createNotification(notification);
      }
    } catch (error) {
      console.error('Error creating hangout match:', error);
    }
  };

  const getHangoutMatches = (): HangoutMatch[] => {
    // Return empty array for now - this should be cached data
    return [];
  };

  const getAllFriendHangouts = () => {
    // Return empty array for now - this should be cached data
    return [];
  };

  const getOverlappingHangouts = async (targetDate: Date) => {
    if (!userId) return [];

    try {
      const friends = await getUserFriends(userId);
      if (!Array.isArray(friends) || friends.length === 0) return [];

      const safeEvents = Array.isArray(events) ? events : [];
      const userHangouts = safeEvents.filter(
        (event) => event.type === "hangout"
      ) as HangoutEvent[];

      const friendIds = friends.map(f => f.id);
      const allFriendEvents = await getEventsByUserIds(friendIds);
      const safeAllFriendEvents = Array.isArray(allFriendEvents) ? allFriendEvents : [];

      const overlaps: Array<{
        userEvent: HangoutEvent;
        friendEvent: HangoutEvent;
        friend: User;
        overlap: { start: string; end: string };
      }> = [];

      userHangouts.forEach((userEvent) => {
        // Check if this event is on the target date
        const eventDate = new Date(userEvent.startTime);
        if (
          eventDate.getDate() === targetDate.getDate() &&
          eventDate.getMonth() === targetDate.getMonth() &&
          eventDate.getFullYear() === targetDate.getFullYear()
        ) {
          friends.forEach((friend) => {
            const friendHangouts = safeAllFriendEvents.filter(
              (event) => event.userId === friend.id && event.type === "hangout"
            ) as HangoutEvent[];

            friendHangouts.forEach((friendEvent) => {
              const overlap = getTimeOverlap(userEvent, friendEvent);
              if (overlap) {
                overlaps.push({
                  userEvent,
                  friendEvent,
                  friend,
                  overlap,
                });
              }
            });
          });
        }
      });

      return overlaps;
    } catch (error) {
      console.error('Error getting overlapping hangouts:', error);
      return [];
    }
  };

  const checkEventOverlap = async (eventId: string) => {
    if (!userId) return null;

    try {
      const safeEvents = Array.isArray(events) ? events : [];
      const targetEvent = safeEvents.find(
        (e) => e.id === eventId && e.type === "hangout"
      ) as HangoutEvent;

      if (!targetEvent || targetEvent.userId !== userId) return null;

      const friends = await getUserFriends(userId);
      if (!Array.isArray(friends) || friends.length === 0) return null;

      const friendIds = friends.map(f => f.id);
      const allFriendEvents = await getEventsByUserIds(friendIds);
      const safeAllFriendEvents = Array.isArray(allFriendEvents) ? allFriendEvents : [];

      for (const friend of friends) {
        const friendHangouts = safeAllFriendEvents.filter(
          (event) => event.userId === friend.id && event.type === "hangout"
        ) as HangoutEvent[];

        for (const friendEvent of friendHangouts) {
          const overlap = getTimeOverlap(targetEvent, friendEvent);
          if (overlap) {
            return {
              userEvent: targetEvent,
              friendEvent,
              friend,
              overlap,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking event overlap:', error);
      return null;
    }
  };

  return {
    events: Array.isArray(events) ? events : [],
    isLoading,
    error,
    createEvent,
    updateEvent,
    deleteEvent,
    getFriendEvents,
    getFriendHangouts,
    getHangoutMatches,
    getAllFriendHangouts,
    getOverlappingHangouts,
    checkEventOverlap,
    loadEvents,
  };
};
