import { v4 as uuidv4 } from 'uuid';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  query, 
  where, 
  getDocs, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Generate an anonymous session ID for non-authenticated users
 */
export const generateSessionId = (): string => {
  return uuidv4();
};

/**
 * Get or create a session ID from localStorage
 */
export const getSessionId = (): string => {
  const storageKey = 'bilo_session_id';
  let sessionId = localStorage.getItem(storageKey);

  if (!sessionId) {
    sessionId = generateSessionId();
    localStorage.setItem(storageKey, sessionId);
  }

  return sessionId;
};

/**
 * Get device and browser information
 */
export const getDeviceInfo = (): {
  userAgent: string;
  screenSize: string;
  language: string;
  referrer: string;
  platform: string;
} => {
  return {
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    referrer: document.referrer,
    platform: navigator.platform
  };
};

/**
 * Get the base URL for authentication actions like email verification and password reset
 */
export const getActionBaseUrl = (): string => {
  // In production always use the actual domain
  return 'https://bilo.fi/auth/action';
};

/**
 * Create an authentication token for a specific purpose
 * @param email User's email
 * @param userId User's ID
 * @param type Type of token (emailVerification or passwordReset)
 * @param expiresIn Expiration time in hours (default 24)
 * @returns Generated token string
 */
export const createAuthToken = async (
  email: string,
  userId: string,
  type: 'emailVerification' | 'passwordReset',
  expiresIn: number = 24
): Promise<string> => {
  try {
    // Generate a unique token
    const token = uuidv4();
    
    // Calculate expiration date
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 60 * 60 * 1000);
    
    // Create token document in Firestore
    const tokensRef = collection(db, 'auth_tokens');
    const tokenDocRef = doc(tokensRef);
    
    await setDoc(tokenDocRef, {
      token,
      userId,
      email,
      type,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
      used: false,
      usedAt: null,
      deviceInfo: getDeviceInfo()
    });
    
    return token;
  } catch (error) {
    console.error('Error creating auth token:', error);
    throw new Error('Failed to create authentication token');
  }
};

/**
 * Invalidate existing tokens for a user of a specific type
 * @param userId User's ID
 * @param type Type of token to invalidate
 * @returns Boolean indicating success
 */
export const invalidateUserTokens = async (
  userId: string,
  type: 'emailVerification' | 'passwordReset'
): Promise<boolean> => {
  try {
    // Query for existing tokens
    const tokensRef = collection(db, 'auth_tokens');
    const q = query(
      tokensRef,
      where('userId', '==', userId),
      where('type', '==', type),
      where('used', '==', false)
    );
    
    const tokenSnap = await getDocs(q);
    
    // Mark all tokens as used
    const updates = tokenSnap.docs.map(doc => {
      return updateDoc(doc.ref, {
        used: true,
        usedAt: serverTimestamp(),
        invalidatedReason: 'replaced_with_new_token'
      });
    });
    
    await Promise.all(updates);
    return true;
  } catch (error) {
    console.error('Error invalidating tokens:', error);
    return false;
  }
};

/**
 * Validate an authentication token
 * @param token Token to validate
 * @param type Expected token type
 * @returns Validation result with token data
 */
export const validateAuthToken = async (
  token: string,
  type: 'emailVerification' | 'passwordReset'
): Promise<{
  valid: boolean;
  userId?: string;
  email?: string;
  error?: string;
}> => {
  try {
    // Query for the token
    const tokensRef = collection(db, 'auth_tokens');
    const q = query(
      tokensRef,
      where('token', '==', token),
      where('type', '==', type)
    );
    
    const tokenSnap = await getDocs(q);
    
    if (tokenSnap.empty) {
      return { valid: false, error: 'Token not found' };
    }
    
    const tokenDoc = tokenSnap.docs[0];
    const tokenData = tokenDoc.data();
    
    // Check if token is already used
    if (tokenData.used) {
      return { valid: false, error: 'Token already used' };
    }
    
    // Check if token is expired
    const expiresAt = tokenData.expiresAt.toDate();
    if (expiresAt < new Date()) {
      return { valid: false, error: 'Token expired' };
    }
    
    // Token is valid
    return {
      valid: true,
      userId: tokenData.userId,
      email: tokenData.email
    };
  } catch (error) {
    console.error('Error validating token:', error);
    return { valid: false, error: 'Validation failed' };
  }
};

/**
 * Mark a token as used after successful verification
 * @param token Token to mark as used
 * @returns Boolean indicating success
 */
export const markTokenAsUsed = async (token: string): Promise<boolean> => {
  try {
    // Query for the token
    const tokensRef = collection(db, 'auth_tokens');
    const q = query(tokensRef, where('token', '==', token));
    
    const tokenSnap = await getDocs(q);
    
    if (tokenSnap.empty) {
      return false;
    }
    
    const tokenDoc = tokenSnap.docs[0];
    
    // Mark token as used
    await updateDoc(tokenDoc.ref, {
      used: true,
      usedAt: serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error('Error marking token as used:', error);
    return false;
  }
};
