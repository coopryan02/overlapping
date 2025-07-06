import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  arrayUnion,
  arrayRemove,
  addDoc,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  deleteDoc,
  documentId,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User, Event, Message, Conversation, Notification } from '@/types';

// Helper function to generate IDs
const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
};

// Debug and repair functions
export const debugUserData = async (email: string) => {
  try {
    console.log('🔍 Debugging user data for:', email);
    
    // Check all users collection
    const allUsersSnapshot = await getDocs(collection(db, 'users'));
    console.log('📊 Total users in collection:', allUsersSnapshot.size);
    
    allUsersSnapshot.forEach(doc => {
      const userData = doc.data();
      console.log('User doc:', doc.id, userData);
      if (userData.email === email.toLowerCase()) {
        console.log('🎯 Found matching email:', userData);
      }
    });
    
    // Check current auth user
    const currentUser = auth.currentUser;
    if (currentUser) {
      console.log('🔐 Current auth user:', {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName
      });
    }
    
  } catch (error) {
    console.error('Debug error:', error);
  }
};

export const repairUserData = async (): Promise<boolean> => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.log('No authenticated user to repair');
      return false;
    }
    
    console.log('🔧 Attempting to repair user data for:', currentUser.uid);
    
    // Check if document exists
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (userDoc.exists()) {
      console.log('✅ User document already exists');
      return true;
    }
    
    // Create missing document
    const userData: User = {
      id: currentUser.uid,
      email: currentUser.email?.toLowerCase() || '',
      username: currentUser.email?.split('@')[0].toLowerCase() || '',
      fullName: currentUser.displayName || currentUser.email?.split('@')[0] || '',
      friends: [],
      friendRequests: {
        sent: [],
        received: [],
      },
      createdAt: new Date().toISOString(),
    };
    
    await setDoc(doc(db, 'users', currentUser.uid), userData);
    console.log('✅ Created missing user document:', userData);
    return true;
    
  } catch (error) {
    console.error('❌ Repair failed:', error);
    return false;
  }
};

// Test function - remove after confirming Firestore works
export const testFirestoreConnection = async () => {
  try {
    const testDoc = doc(db, 'test', 'connection');
    await setDoc(testDoc, {
      message: 'Firestore connection successful!',
      timestamp: new Date()
    });
    
    const docSnap = await getDoc(testDoc);
    if (docSnap.exists()) {
      console.log('✅ Firestore connection test successful:', docSnap.data());
      // Clean up test document
      await deleteDoc(testDoc);
      return true;
    }
  } catch (error) {
    console.error('❌ Firestore connection test failed:', error);
    return false;
  }
};

// User Authentication Functions
export const createUserAccount = async (
  email: string,
  password: string,
  username: string,
  fullName: string
): Promise<{ success: boolean; error?: string; user?: User }> => {
  try {
    // Check if username already exists
    const usernameQuery = query(
      collection(db, 'users'),
      where('username', '==', username.toLowerCase())
    );
    const usernameSnapshot = await getDocs(usernameQuery);
    
    if (!usernameSnapshot.empty) {
      return { success: false, error: 'Username already exists' };
    }

    // Create Firebase auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;

    // Update Firebase auth profile
    await updateProfile(firebaseUser, { displayName: fullName });

    // Create user document in Firestore
    const userData: User = {
      id: firebaseUser.uid,
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      fullName,
      friends: [],
      friendRequests: {
        sent: [],
        received: [],
      },
      createdAt: new Date().toISOString(),
    };

    // Use setDoc with merge option to ensure document is created
    await setDoc(doc(db, 'users', firebaseUser.uid), userData, { merge: false });

    // Wait a bit and verify the document was created
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const verifyDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
    if (!verifyDoc.exists()) {
      throw new Error('Failed to create user document in Firestore');
    }

    console.log('✅ User document created successfully:', userData);
    return { success: true, user: userData };
  } catch (error: any) {
    console.error('Create user error:', error);
    return { success: false, error: error.message };
  }
};

export const signInUser = async (
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; user?: User }> => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;

    console.log('🔍 Firebase user authenticated:', {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName
    });

    // Get user data from Firestore with retry logic
    let userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
    let retryCount = 0;
    const maxRetries = 3;
    
    // Retry if document doesn't exist (for newly created accounts)
    while (!userDoc.exists() && retryCount < maxRetries) {
      console.log(`Retrying to get user document... Attempt ${retryCount + 1}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      retryCount++;
    }
    
    if (!userDoc.exists()) {
      console.error('❌ User document not found in Firestore for UID:', firebaseUser.uid);
      
      // Check if we can find the user by email instead
      console.log('🔍 Searching for user by email...');
      const emailQuery = query(
        collection(db, 'users'),
        where('email', '==', email.toLowerCase())
      );
      const emailSnapshot = await getDocs(emailQuery);
      
      if (!emailSnapshot.empty) {
        console.log('📧 Found user by email, but UID mismatch!');
        const foundUser = emailSnapshot.docs[0].data() as User;
        console.log('Found user data:', foundUser);
        console.log('Auth UID:', firebaseUser.uid);
        console.log('Stored UID:', foundUser.id);
        
        // Try to update the stored user document with correct UID
        try {
          const correctedUserData = { ...foundUser, id: firebaseUser.uid };
          await setDoc(doc(db, 'users', firebaseUser.uid), correctedUserData);
          // Delete the old document if it has a different ID
          if (foundUser.id !== firebaseUser.uid) {
            await deleteDoc(doc(db, 'users', foundUser.id));
          }
          console.log('✅ Fixed user document UID mismatch');
          return { success: true, user: correctedUserData };
        } catch (fixError) {
          console.error('❌ Failed to fix UID mismatch:', fixError);
        }
      }
      
      // As a last resort, create the missing user document
      console.log('🔧 Creating missing user document...');
      try {
        const userData: User = {
          id: firebaseUser.uid,
          email: email.toLowerCase(),
          username: email.split('@')[0].toLowerCase(), // Use email prefix as username
          fullName: firebaseUser.displayName || email.split('@')[0],
          friends: [],
          friendRequests: {
            sent: [],
            received: [],
          },
          createdAt: new Date().toISOString(),
        };
        
        await setDoc(doc(db, 'users', firebaseUser.uid), userData);
        console.log('✅ Created missing user document:', userData);
        return { success: true, user: userData };
      } catch (createError) {
        console.error('❌ Failed to create missing user document:', createError);
        throw new Error('User data not found and could not be created');
      }
    }

    const userData = userDoc.data() as User;
    console.log('✅ User signed in successfully:', userData);
    return { success: true, user: userData };
  } catch (error: any) {
    console.error('Sign in error:', error);
    return { success: false, error: error.message };
  }
};

export const signOutUser = async (): Promise<void> => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
};

export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
    if (firebaseUser) {
      try {
        // Wait a bit for Firestore to sync
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          callback(userData);
        } else {
          console.warn('User document not found for authenticated user');
          callback(null);
        }
      } catch (error) {
        console.error('Error getting user data:', error);
        callback(null);
      }
    } else {
      callback(null);
    }
  });
};

// User Management Functions
export const searchUsers = async (query: string, currentUserId: string): Promise<User[]> => {
  try {
    const searchTerm = query.toLowerCase().trim();
    if (!searchTerm) return [];

    // Search by username
    const usernameQuery = query(
      collection(db, 'users'),
      where('username', '>=', searchTerm),
      where('username', '<=', searchTerm + '\uf8ff'),
      limit(10)
    );

    // Search by full name
    const nameQuery = query(
      collection(db, 'users'),
      where('fullName', '>=', searchTerm),
      where('fullName', '<=', searchTerm + '\uf8ff'),
      limit(10)
    );

    const [usernameSnapshot, nameSnapshot] = await Promise.all([
      getDocs(usernameQuery),
      getDocs(nameQuery)
    ]);

    const users = new Map<string, User>();

    // Combine results and remove duplicates
    [...usernameSnapshot.docs, ...nameSnapshot.docs].forEach(doc => {
      const userData = doc.data() as User;
      if (userData.id !== currentUserId) {
        users.set(userData.id, userData);
      }
    });

    return Array.from(users.values());
  } catch (error) {
    console.error('Search users error:', error);
    return [];
  }
};

export const sendFriendRequest = async (fromUserId: string, toUserId: string): Promise<boolean> => {
  try {
    const batch = writeBatch(db);

    // Update sender's sent requests
    const fromUserRef = doc(db, 'users', fromUserId);
    batch.update(fromUserRef, {
      'friendRequests.sent': arrayUnion(toUserId)
    });

    // Update receiver's received requests
    const toUserRef = doc(db, 'users', toUserId);
    batch.update(toUserRef, {
      'friendRequests.received': arrayUnion(fromUserId)
    });

    // Create notification
    const notification: Omit<Notification, 'id'> = {
      userId: toUserId,
      type: 'friend_request',
      title: 'New Friend Request',
      message: 'You have a new friend request',
      read: false,
      createdAt: new Date().toISOString(),
      data: { fromUserId }
    };

    const notificationRef = doc(collection(db, 'notifications'));
    batch.set(notificationRef, { ...notification, id: notificationRef.id });

    await batch.commit();
    return true;
  } catch (error) {
    console.error('Send friend request error:', error);
    return false;
  }
};

export const acceptFriendRequest = async (userId: string, requesterId: string): Promise<boolean> => {
  try {
    const batch = writeBatch(db);

    // Update both users
    const userRef = doc(db, 'users', userId);
    const requesterRef = doc(db, 'users', requesterId);

    batch.update(userRef, {
      'friendRequests.received': arrayRemove(requesterId),
      'friends': arrayUnion(requesterId)
    });

    batch.update(requesterRef, {
      'friendRequests.sent': arrayRemove(userId),
      'friends': arrayUnion(userId)
    });

    await batch.commit();
    return true;
  } catch (error) {
    console.error('Accept friend request error:', error);
    return false;
  }
};

export const rejectFriendRequest = async (userId: string, requesterId: string): Promise<boolean> => {
  try {
    const batch = writeBatch(db);

    const userRef = doc(db, 'users', userId);
    const requesterRef = doc(db, 'users', requesterId);

    batch.update(userRef, {
      'friendRequests.received': arrayRemove(requesterId)
    });

    batch.update(requesterRef, {
      'friendRequests.sent': arrayRemove(userId)
    });

    await batch.commit();
    return true;
  } catch (error) {
    console.error('Reject friend request error:', error);
    return false;
  }
};

// Event Functions
export const createEvent = async (event: Omit<Event, 'id'>): Promise<string | null> => {
  try {
    const eventRef = doc(collection(db, 'events'));
    const eventData = { ...event, id: eventRef.id };
    await setDoc(eventRef, eventData);
    return eventRef.id;
  } catch (error) {
    console.error('Create event error:', error);
    return null;
  }
};

export const getUserEvents = async (userId: string): Promise<Event[]> => {
  try {
    const eventsQuery = query(
      collection(db, 'events'),
      where('userId', '==', userId),
      orderBy('startTime', 'desc')
    );
    
    const snapshot = await getDocs(eventsQuery);
    return snapshot.docs.map(doc => doc.data() as Event);
  } catch (error) {
    console.error('Get user events error:', error);
    return [];
  }
};

export const updateEvent = async (eventId: string, updates: Partial<Event>): Promise<boolean> => {
  try {
    await updateDoc(doc(db, 'events', eventId), updates);
    return true;
  } catch (error) {
    console.error('Update event error:', error);
    return false;
  }
};

export const deleteEvent = async (eventId: string): Promise<boolean> => {
  try {
    await deleteDoc(doc(db, 'events', eventId));
    return true;
  } catch (error) {
    console.error('Delete event error:', error);
    return false;
  }
};

export const getEventsByUserIds = async (userIds: string[]): Promise<Event[]> => {
  try {
    if (userIds.length === 0) return [];
    
    // Firestore 'in' queries are limited to 10 items, so we need to batch them
    const batches = [];
    for (let i = 0; i < userIds.length; i += 10) {
      const batch = userIds.slice(i, i + 10);
      const eventsQuery = query(
        collection(db, 'events'),
        where('userId', 'in', batch)
      );
      batches.push(getDocs(eventsQuery));
    }
    
    const snapshots = await Promise.all(batches);
    const events: Event[] = [];
    
    snapshots.forEach(snapshot => {
      snapshot.docs.forEach(doc => {
        events.push({ id: doc.id, ...doc.data() } as Event);
      });
    });
    
    return events;
  } catch (error) {
    console.error('Get events by user IDs error:', error);
    return [];
  }
};

export const getUserFriends = async (userId: string): Promise<User[]> => {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) return [];
    
    const userData = userDoc.data();
    const friendIds = userData.friends || [];
    
    if (friendIds.length === 0) return [];
    
    // Get friend user documents in batches (Firestore 'in' limit is 10)
    const batches = [];
    for (let i = 0; i < friendIds.length; i += 10) {
      const batch = friendIds.slice(i, i + 10);
      const friendsQuery = query(
        collection(db, 'users'),
        where(documentId(), 'in', batch)
      );
      batches.push(getDocs(friendsQuery));
    }
    
    const snapshots = await Promise.all(batches);
    const friends: User[] = [];
    
    snapshots.forEach(snapshot => {
      snapshot.docs.forEach(doc => {
        friends.push({ id: doc.id, ...doc.data() } as User);
      });
    });
    
    return friends;
  } catch (error) {
    console.error('Get user friends error:', error);
    // Fallback: get friends one by one
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) return [];
      
      const userData = userDoc.data();
      const friendIds = userData.friends || [];
      
      const friendPromises = friendIds.map((friendId: string) =>
        getDoc(doc(db, 'users', friendId))
      );
      
      const friendDocs = await Promise.all(friendPromises);
      return friendDocs
        .filter(doc => doc.exists())
        .map(doc => ({ id: doc.id, ...doc.data() } as User));
    } catch (fallbackError) {
      console.error('Fallback get user friends error:', fallbackError);
      return [];
    }
  }
};

// Message Functions
export const sendMessage = async (message: Omit<Message, 'id'>): Promise<boolean> => {
  try {
    const conversationId = [message.senderId, message.receiverId].sort().join('-');
    
    // Add message to messages collection
    const messageRef = doc(collection(db, 'messages'));
    const messageData = { ...message, id: messageRef.id, conversationId };
    await setDoc(messageRef, messageData);

    // Update or create conversation
    const conversationRef = doc(db, 'conversations', conversationId);
    const conversationDoc = await getDoc(conversationRef);

    const conversationData: Conversation = {
      id: conversationId,
      participants: [message.senderId, message.receiverId],
      messages: [], // We'll load messages separately for better performance
      lastMessage: messageData,
      updatedAt: message.timestamp,
    };

    if (conversationDoc.exists()) {
      await updateDoc(conversationRef, {
        lastMessage: messageData,
        updatedAt: message.timestamp,
      });
    } else {
      await setDoc(conversationRef, conversationData);
    }

    return true;
  } catch (error) {
    console.error('Send message error:', error);
    return false;
  }
};

export const getUserConversations = async (userId: string): Promise<Conversation[]> => {
  try {
    const conversationsQuery = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', userId),
      orderBy('updatedAt', 'desc')
    );

    const snapshot = await getDocs(conversationsQuery);
    return snapshot.docs.map(doc => doc.data() as Conversation);
  } catch (error) {
    console.error('Get conversations error:', error);
    return [];
  }
};

export const getConversationMessages = async (conversationId: string): Promise<Message[]> => {
  try {
    const messagesQuery = query(
      collection(db, 'messages'),
      where('conversationId', '==', conversationId),
      orderBy('timestamp', 'asc')
    );

    const snapshot = await getDocs(messagesQuery);
    return snapshot.docs.map(doc => doc.data() as Message);
  } catch (error) {
    console.error('Get messages error:', error);
    return [];
  }
};

// Notification Functions
export const getUserNotifications = async (userId: string): Promise<Notification[]> => {
  try {
    const notificationsQuery = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const snapshot = await getDocs(notificationsQuery);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Notification));
  } catch (error) {
    console.error('Get notifications error:', error);
    return [];
  }
};

export const markNotificationAsRead = async (notificationId: string): Promise<boolean> => {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true });
    return true;
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return false;
  }
};

export const createNotification = async (notification: Omit<Notification, 'id'>): Promise<string | null> => {
  try {
    const notificationRef = doc(collection(db, 'notifications'));
    const notificationData = { ...notification, id: notificationRef.id };
    await setDoc(notificationRef, notificationData);
    return notificationRef.id;
  } catch (error) {
    console.error('Create notification error:', error);
    return null;
  }
};

// Real-time listeners
export const subscribeToUserNotifications = (
  userId: string,
  callback: (notifications: Notification[]) => void
) => {
  try {
    const notificationsQuery = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    return onSnapshot(
      notificationsQuery,
      (snapshot) => {
        try {
          const notifications: Notification[] = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (data && typeof data === 'object') {
              notifications.push({
                id: doc.id,
                ...data,
                // Ensure createdAt is a string
                createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt
              } as Notification);
            }
          });
          callback(notifications);
        } catch (processError) {
          console.error('Error processing notification snapshot:', processError);
          callback([]);
        }
      },
      (error) => {
        console.error('Notification subscription error:', error);
        callback([]);
      }
    );
  } catch (error) {
    console.error('Error setting up notification subscription:', error);
    return () => {}; // Return empty unsubscribe function
  }
};

export const subscribeToConversationMessages = (
  conversationId: string,
  callback: (messages: Message[]) => void
) => {
  const messagesQuery = query(
    collection(db, 'messages'),
    where('conversationId', '==', conversationId),
    orderBy('timestamp', 'asc')
  );

  return onSnapshot(messagesQuery, (snapshot) => {
    const messages = snapshot.docs.map(doc => doc.data() as Message);
    callback(messages);
  });
};

// Conversation Service Functions
export const conversationService = {
  async getAll(): Promise<Conversation[]> {
    try {
      const snapshot = await getDocs(collection(db, 'conversations'));
      const conversations = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const conversationData = doc.data() as Conversation;
          // Load messages for each conversation
          const messages = await getConversationMessages(conversationData.id);
          return {
            ...conversationData,
            messages
          };
        })
      );
      return conversations;
    } catch (error) {
      console.error('Get all conversations error:', error);
      return [];
    }
  },

  async addMessage(message: Message): Promise<boolean> {
    try {
      const conversationId = [message.senderId, message.receiverId].sort().join('-');
      
      // Add conversationId to message
      const messageWithConvId = { ...message, conversationId };
      
      // Add message to messages collection
      const messageRef = doc(db, 'messages', message.id);
      await setDoc(messageRef, messageWithConvId);

      // Update or create conversation
      const conversationRef = doc(db, 'conversations', conversationId);
      const conversationDoc = await getDoc(conversationRef);

      if (conversationDoc.exists()) {
        await updateDoc(conversationRef, {
          updatedAt: message.timestamp,
        });
      } else {
        const conversationData: Conversation = {
          id: conversationId,
          participants: [message.senderId, message.receiverId],
          messages: [],
          updatedAt: message.timestamp,
        };
        await setDoc(conversationRef, conversationData);
      }

      return true;
    } catch (error) {
      console.error('Add message error:', error);
      return false;
    }
  },

  async update(conversationId: string, conversation: Conversation): Promise<boolean> => {
    try {
      // Update conversation document
      await updateDoc(doc(db, 'conversations', conversationId), {
        updatedAt: conversation.updatedAt
      });

      // Update messages in batch
      const batch = writeBatch(db);
      conversation.messages.forEach(message => {
        const messageRef = doc(db, 'messages', message.id);
        batch.set(messageRef, { ...message, conversationId }, { merge: true });
      });
      
      await batch.commit();
      return true;
    } catch (error) {
      console.error('Update conversation error:', error);
      return false;
    }
  },

  async delete(conversationId: string): Promise<boolean> => {
    try {
      const batch = writeBatch(db);

      // Delete all messages in the conversation
      const messagesQuery = query(
        collection(db, 'messages'),
        where('conversationId', '==', conversationId)
      );
      const messagesSnapshot = await getDocs(messagesQuery);
      
      messagesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      // Delete the conversation
      batch.delete(doc(db, 'conversations', conversationId));

      await batch.commit();
      return true;
    } catch (error) {
      console.error('Delete conversation error:', error);
      return false;
    }
  },

  async create(conversation: Conversation): Promise<boolean> => {
    try {
      await setDoc(doc(db, 'conversations', conversation.id), conversation);
      return true;
    } catch (error) {
      console.error('Create conversation error:', error);
      return false;
    }
  }
};

// User Service Functions
export const userService = {
  async getAll(): Promise<User[]> {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      return snapshot.docs.map(doc => doc.data() as User);
    } catch (error) {
      console.error('Get all users error:', error);
      return [];
    }
  }
};

// Notification Service Functions
export const notificationService = {
  async createNotification(notification: Omit<Notification, 'id'>): Promise<string | null> {
    try {
      const notificationRef = doc(collection(db, 'notifications'));
      const notificationData = {
        ...notification,
        id: notificationRef.id,
        createdAt: notification.createdAt || new Date().toISOString()
      };
      await setDoc(notificationRef, notificationData);
      return notificationRef.id;
    } catch (error) {
      console.error('Create notification error:', error);
      return null;
    }
  },

  async getNotifications(userId: string): Promise<Notification[]> {
    try {
      const notificationsQuery = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(50)
      );

      const snapshot = await getDocs(notificationsQuery);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Notification));
    } catch (error) {
      console.error('Get notifications error:', error);
      return [];
    }
  },

  async markAsRead(notificationId: string): Promise<boolean> => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), { read: true });
      return true;
    } catch (error) {
      console.error('Mark notification as read error:', error);
      return false;
    }
  },

  async deleteNotification(notificationId: string): Promise<boolean> => {
    try {
      await deleteDoc(doc(db, 'notifications', notificationId));
      return true;
    } catch (error) {
      console.error('Delete notification error:', error);
      return false;
    }
  },

  async clearAllNotifications(userId: string): Promise<boolean> => {
    try {
      const notificationsQuery = query(collection(db, 'notifications'),
       where('userId', '==', userId)
     );
     
     const snapshot = await getDocs(notificationsQuery);
     const batch = writeBatch(db);
     
     snapshot.docs.forEach(doc => {
       batch.delete(doc.ref);
     });
     
     await batch.commit();
     return true;
   } catch (error) {
     console.error('Clear all notifications error:', error);
     return false;
   }
 },

 // Add create method for compatibility
 async create(notification: Omit<Notification, 'id'>): Promise<string | null> {
   return this.createNotification(notification);
 }
};
