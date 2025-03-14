import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  Timestamp,
  serverTimestamp,
  limit,
  updateDoc,
  orderBy,
  increment,
  arrayUnion,
  runTransaction,
  deleteDoc
} from 'firebase/firestore';
import { db, COLLECTIONS } from './firebase';
import type { User, Vendor, Service, ServiceCategory, Appointment, Transaction, Promotion, Offer } from '../types/database';
import { DEFAULT_SERVICES } from './defaultServices';
import { sendAppointmentConfirmation, sendWelcomeEmail, sendVendorNotification } from './email';
import { writeBatch } from 'firebase/firestore';

export const addFeedback = async (appointmentId: string, feedback: { rating: number; comment: string }) => {
  const appointmentRef = doc(db, COLLECTIONS.APPOINTMENTS, appointmentId);
  const appointmentSnap = await getDoc(appointmentRef);
  
  if (!appointmentSnap.exists()) {
    throw new Error('Varausta ei löytynyt');
  }
  
  const appointment = appointmentSnap.data() as Appointment;
  
  // First update the appointment with feedback
  const feedbackData = {
    feedback: {
      ...feedback,
      createdAt: Timestamp.now()
    }
  };
  
  await updateDoc(appointmentRef, feedbackData);
  
  // Then update vendor rating
  const vendorRef = doc(db, COLLECTIONS.VENDORS, appointment.vendorId);
  const vendorDoc = await getDoc(vendorRef);
  
  if (!vendorDoc.exists()) {
    throw new Error('Yritystä ei löytynyt');
  }
  
  const vendor = vendorDoc.data();

  // Calculate new rating
  const currentRating = vendor.rating || 0;
  const ratingCount = (vendor.ratingCount || 0);
  const newRating = ((currentRating * ratingCount) + feedback.rating) / (ratingCount + 1);

  // Update vendor rating
  await updateDoc(vendorRef, {
    rating: Number(newRating.toFixed(1)),
    ratingCount: increment(1)
  });

  return true;
};
import type { User, Vendor, Service, ServiceCategory, Appointment, Transaction, Promotion, SupportTicket } from '../types/database';

// Check if business ID or phone is already in use
export const checkFieldUniqueness = async (field: 'businessId' | 'phone', value: string): Promise<boolean> => {
  if (!value) return true; // Empty values are considered "unique"
  
  // Check vendors collection for the field
  const vendorsQuery = query(
    collection(db, COLLECTIONS.VENDORS),
    where(field, '==', value),
    limit(1)
  );
  
  const vendorsSnapshot = await getDocs(vendorsQuery);
  
  // If we found any vendor with this field, it's not unique
  return vendorsSnapshot.empty;
};

// User operations
export const createUser = async (userId: string, userData: Partial<User>) => {
  const userRef = doc(db, COLLECTIONS.USERS, userId);
  const isVendor = userData.role === 'vendor';
  
  // Base user data
  const baseUserData = {
    ...userData,
    createdAt: serverTimestamp(),
    referralCode: crypto.randomUUID().slice(0, 8),
    referralCount: 0
  };

  // Add welcome bonus only for customers
  if (!isVendor) {
    baseUserData.wallet = {
      coins: 10, // Welcome bonus
      transactions: [{
        id: crypto.randomUUID(),
        amount: 10,
        type: 'credit',
        description: 'Tervetuliaislahja uudelle jäsenelle',
        timestamp: Timestamp.now()
      }]
    };
  } else {
    baseUserData.wallet = {
      coins: 0,
      transactions: []
    };
  }

  await setDoc(userRef, baseUserData);
  
  // Send welcome email for new users
  if (!isVendor) {
    try {
      await sendWelcomeEmail({ ...baseUserData, id: userRef.id } as User);
    } catch (error) {
      console.error('Error sending welcome email:', error);
      // Don't throw error to avoid blocking user creation
    }
  }

  // If user is a vendor, create vendor document immediately
  if (isVendor) {
    const vendorRef = doc(collection(db, COLLECTIONS.VENDORS));
    const vendorId = vendorRef.id;
    
    // Create vendor document with default values
    const vendorDoc = {
      id: vendorId,
      userId,
      businessName: '',
      address: '',
      businessId: '',
      city: '',
      postalCode: '',
      phone: '',
      email: userData.email || '',
      services: [],
      rating: 0,
      ratingCount: 0,
      verified: false,
      operatingHours: {
        monday: { open: '09:00', close: '17:00' },
        tuesday: { open: '09:00', close: '17:00' },
        wednesday: { open: '09:00', close: '17:00' },
        thursday: { open: '09:00', close: '17:00' },
        friday: { open: '09:00', close: '17:00' },
        saturday: { open: 'closed', close: 'closed' },
        sunday: { open: 'closed', close: 'closed' }
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    // Initialize default categories for this vendor
    const batch = writeBatch(db);
    batch.set(vendorRef, vendorDoc);
    
    // Create default categories
    const defaultCategories = [
      {
        name: 'Peruspesu',
        description: 'Peruspesut ja pikapesut',
        icon: 'car',
        order: 1,
        vendorId
      },
      {
        name: 'Sisäpesu',
        description: 'Auton sisätilojen puhdistus',
        icon: 'armchair',
        order: 2,
        vendorId
      },
      {
        name: 'Premium',
        description: 'Premium-tason pesut ja käsittelyt',
        icon: 'star',
        order: 3,
        vendorId
      },
      {
        name: 'Erikoispalvelut',
        description: 'Erikoiskäsittelyt ja lisäpalvelut',
        icon: 'sparkles',
        order: 4,
        vendorId
      }
    ];
    
    defaultCategories.forEach(category => {
      const categoryRef = doc(collection(db, COLLECTIONS.SERVICE_CATEGORIES));
      batch.set(categoryRef, {
        ...category,
        id: categoryRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    
    await batch.commit();
  }
};

export const getUser = async (userId: string): Promise<User | null> => {
  const userRef = doc(db, COLLECTIONS.USERS, userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return null;
  return { id: userSnap.id, ...userSnap.data() } as User;
};

export const deleteUser = async (userId: string) => {
  try {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    // Delete user document
    await deleteDoc(userRef);

    // Delete associated appointments
    const appointmentsQuery = query(
      collection(db, COLLECTIONS.APPOINTMENTS),
      where('customerId', '==', userId)
    );
    const appointmentsSnap = await getDocs(appointmentsQuery);
    const batch = writeBatch(db);
    appointmentsSnap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

export const deleteVendor = async (vendorId: string) => {
  try {
    const vendorRef = doc(db, COLLECTIONS.VENDORS, vendorId);
    // Get vendor data first
    const vendorSnap = await getDoc(vendorRef);
    if (!vendorSnap.exists()) {
      throw new Error('Vendor not found');
    }

    const batch = writeBatch(db);

    // Delete vendor document
    await deleteDoc(vendorRef);

    // Delete associated services
    const servicesQuery = query(
      collection(db, COLLECTIONS.SERVICES),
      where('vendorId', '==', vendorId)
    );
    const servicesSnap = await getDocs(servicesQuery);
    servicesSnap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete associated appointments
    const appointmentsQuery = query(
      collection(db, COLLECTIONS.APPOINTMENTS),
      where('vendorId', '==', vendorId)
    );
    const appointmentsSnap = await getDocs(appointmentsQuery);
    appointmentsSnap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete associated categories
    const categoriesQuery = query(
      collection(db, COLLECTIONS.SERVICE_CATEGORIES),
      where('vendorId', '==', vendorId)
    );
    const categoriesSnap = await getDocs(categoriesQuery);
    categoriesSnap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return true;
  } catch (error) {
    console.error('Error deleting vendor:', error);
    throw error;
  }
};

export const createCustomer = async (customerData: Omit<User, 'id'>) => {
  const userRef = doc(collection(db, COLLECTIONS.USERS));
  await setDoc(userRef, {
    ...customerData,
    id: userRef.id,
    role: 'customer',
    createdAt: serverTimestamp(),
    wallet: {
      coins: 0,
      transactions: []
    }
  });
  return userRef.id;
};

export const createVendorByAdmin = async (vendorData: Omit<Vendor, 'id'> & { email: string }) => {
  // First create user account for vendor
  const userRef = doc(collection(db, COLLECTIONS.USERS));
  await setDoc(userRef, {
    id: userRef.id,
    email: vendorData.email,
    role: 'vendor',
    createdAt: serverTimestamp(),
    wallet: {
      coins: 0,
      transactions: []
    }
  });

  // Then create vendor profile
  const vendorRef = doc(collection(db, COLLECTIONS.VENDORS));
  await setDoc(vendorRef, {
    ...vendorData,
    id: vendorRef.id,
    userId: userRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return {
    userId: userRef.id,
    vendorId: vendorRef.id
  };
};

export const updateUser = async (userId: string, userData: Partial<User>) => {
  try {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    await updateDoc(userRef, {
      ...userData,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

export const addCoinsToUser = async (userId: string, amount: number, description: string) => {
  try {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      amount,
      type: amount > 0 ? 'credit' : 'debit',
      description,
      timestamp: Timestamp.now()
    };

    await updateDoc(userRef, {
      'wallet.coins': increment(amount),
      'wallet.transactions': arrayUnion(transaction)
    });

    return true;
  } catch (error) {
    console.error('Error adding coins:', error);
    throw error;
  }
};

// Referral system
export const applyReferralCode = async (userId: string, referralCode: string) => {
  try {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const q = query(usersRef, where('referralCode', '==', referralCode));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error('Virheellinen suosituskoodi');
    }

    const referrerDoc = querySnapshot.docs[0];
    const referrerId = referrerDoc.id;

    if (referrerId === userId) {
      throw new Error('Et voi käyttää omaa suosituskoodiasi');
    }

    await runTransaction(db, async (transaction) => {
      // Add coins to referrer
      const referrerRef = doc(db, COLLECTIONS.USERS, referrerId);
      const referrerTransaction: Transaction = {
        id: crypto.randomUUID(),
        amount: 20,
        type: 'credit',
        description: 'Suosituspalkkio',
        timestamp: new Date()
      };

      transaction.update(referrerRef, {
        'wallet.coins': increment(20),
        'wallet.transactions': arrayUnion(referrerTransaction),
        'referralCount': increment(1)
      });

      // Add bonus coins to referred user
      const userRef = doc(db, COLLECTIONS.USERS, userId);
      const userTransaction: Transaction = {
        id: crypto.randomUUID(),
        amount: 15,
        type: 'credit',
        description: 'Suosituskoodin bonus',
        timestamp: new Date()
      };

      transaction.update(userRef, {
        'wallet.coins': increment(15),
        'wallet.transactions': arrayUnion(userTransaction),
        'usedReferralCode': referralCode
      });
    });

    return true;
  } catch (error) {
    console.error('Error applying referral code:', error);
    throw error;
  }
};

export const initializeServiceCategories = async (vendorId: string) => {
  // This function is now handled during vendor creation
  return true;
};

// Service Category operations
export const createServiceCategory = async (categoryData: Omit<ServiceCategory, 'id'>) => {
  const categoryRef = doc(collection(db, COLLECTIONS.SERVICE_CATEGORIES)); 
  await setDoc(categoryRef, {
    ...categoryData,
    id: categoryRef.id,
    createdAt: serverTimestamp()
  });
  return categoryRef.id;
};

export const updateServiceCategory = async (categoryId: string, categoryData: Partial<ServiceCategory>) => {
  const categoryRef = doc(db, COLLECTIONS.SERVICE_CATEGORIES, categoryId);
  await updateDoc(categoryRef, {
    ...categoryData,
    updatedAt: serverTimestamp()
  });
  return true;
};

export const getServiceCategories = async (vendorId: string): Promise<ServiceCategory[]> => {
  const q = query(
    collection(db, COLLECTIONS.SERVICE_CATEGORIES),
    where('vendorId', '==', vendorId)
  );
  const querySnapshot = await getDocs(q);
  
  // Sort categories by order after fetching
  const categories = querySnapshot.docs.map(doc => ({ 
    id: doc.id, 
    ...doc.data() 
  }) as ServiceCategory);
  
  return categories.sort((a, b) => (a.order || 0) - (b.order || 0));
};

export const getServiceCategory = async (categoryId: string): Promise<ServiceCategory | null> => {
  const categoryRef = doc(db, COLLECTIONS.SERVICE_CATEGORIES, categoryId);
  const categorySnap = await getDoc(categoryRef);
  if (!categorySnap.exists()) return null;
  return { id: categorySnap.id, ...categorySnap.data() } as ServiceCategory;
};

// Promotions
export const createPromotion = async (promotionData: Omit<Promotion, 'id'>) => {
  const promotionRef = doc(collection(db, COLLECTIONS.PROMOTIONS));
  await setDoc(promotionRef, {
    ...promotionData,
    id: promotionRef.id,
    createdAt: serverTimestamp()
  });
  return promotionRef.id;
};

export const getActivePromotions = async (): Promise<Promotion[]> => {
  const now = new Date();
  const q = query(
    collection(db, COLLECTIONS.PROMOTIONS),
    where('startDate', '<=', now),
    where('endDate', '>=', now)
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Promotion);
};

// Offer operations
export const createOffer = async (offerData: Omit<Offer, 'id' | 'createdAt' | 'updatedAt'>) => {
  const offerRef = doc(collection(db, COLLECTIONS.OFFERS));
  await setDoc(offerRef, {
    ...offerData,
    id: offerRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return offerRef.id;
};

export const updateOffer = async (offerId: string, offerData: Partial<Offer>) => {
  const offerRef = doc(db, COLLECTIONS.OFFERS, offerId);
  await updateDoc(offerRef, {
    ...offerData,
    updatedAt: serverTimestamp()
  });
  return true;
};

export const getVendorOffers = async (vendorId: string) => {
  const q = query(
    collection(db, COLLECTIONS.OFFERS),
    where('vendorId', '==', vendorId),
    orderBy('startDate', 'desc')
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      startDate: data.startDate.toDate(),
      endDate: data.endDate.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate()
    } as Offer;
  });
};

export const searchVendors = async (searchQuery: string): Promise<Vendor[]> => {
  try {
    // Get all verified vendors that are not banned/deleted
    let vendorsQuery = query(
      collection(db, COLLECTIONS.VENDORS),
      where('verified', '==', true),
      where('banned', '!=', true), // Exclude banned vendors
      limit(50) // Limit results for better performance
    );
    
    const vendorsSnapshot = await getDocs(vendorsQuery);
    let vendors = vendorsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }) as Vendor);
    
    // Additional filter to ensure we don't show vendors with banned=true
    // This is a safety measure in case the where clause doesn't work as expected
    vendors = vendors.filter(vendor => vendor.banned !== true);
    
    // Get city filter from URL
    const cityFilter = new URLSearchParams(window.location.search).get('city')?.toLowerCase() || '';
    
    // Filter vendors by city if specified
    if (cityFilter) {
      vendors = vendors.filter(vendor => 
        vendor.city?.toLowerCase() === cityFilter
      );
      
      // If no vendors in city, return empty array with special flag
      if (vendors.length === 0) {
        return [];
      }
    }

    // Then get services matching the search query
    const servicesSnapshot = await getDocs(collection(db, COLLECTIONS.SERVICES));
     const searchTerm = searchQuery.toLowerCase();
     const matchingVendorIds = new Set<string>();
     let error = null;
    
    try {
      servicesSnapshot.docs.forEach(doc => {
        const service = doc.data() as Service;
        if (
          service.name?.toLowerCase().includes(searchTerm) ||
        (service.name || '').toLowerCase().includes(searchTerm) ||
        (service.description || '').toLowerCase().includes(searchTerm)
        ) {
          matchingVendorIds.add(service.vendorId);
        }
      });

      // Filter vendors that have matching services 
      const matchingVendors = vendors.filter(vendor => matchingVendorIds.has(vendor.id));
    
      // If no matching services but vendors exist in city, return all vendors
      if (matchingVendors.length === 0 && vendors.length > 0) {
        return vendors;
      }
    
      return matchingVendors;
    } catch (err) {
      console.error('Error processing services:', err);
      error = err;
      // Return all vendors if service matching fails
      return vendors;
    }

  } catch (error) {
    console.error('Error searching vendors:', { error });
    // Return empty array instead of throwing to handle gracefully
    return [];
  }
};

export const getRecommendedServices = async (): Promise<Service[]> => {
  try {
    // First get active vendors that are not banned
    const vendorsQuery = query(
      collection(db, COLLECTIONS.VENDORS),
      where('verified', '==', true),
      where('banned', '!=', true)
    );
    
    const vendorsSnapshot = await getDocs(vendorsQuery);
    const validVendorIds = vendorsSnapshot.docs.map(doc => doc.id);
    
    // Then get services from those vendors
    const servicesQuery = query(
      collection(db, COLLECTIONS.SERVICES),
      where('available', '==', true),
      limit(15) // Get more than needed to filter
    );
    
    const querySnapshot = await getDocs(servicesQuery);
    const services = querySnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }) as Service)
      .filter(service => validVendorIds.includes(service.vendorId)); // Only include services from valid vendors
    
    // Return up to 5 services
    return services.slice(0, 5);
  } catch (error) {
    console.error('Error getting recommended services:', error);
    return [];
  }
};

// Vendor operations
export const createVendor = async (vendorData: Omit<Vendor, 'id'>) => {
  const vendorRef = doc(collection(db, COLLECTIONS.VENDORS));
  const vendorId = vendorRef.id;
  const now = serverTimestamp();
  
  // Create vendor document
  const vendorDoc = {
    ...vendorData,
    id: vendorId,
    rating: 0,
    ratingCount: 0,
    services: [],
    verified: false, // New vendors start unverified
    createdAt: now,
    updatedAt: now
  };
  
  // Initialize default categories for this vendor
  const batch = writeBatch(db);
  batch.set(vendorRef, vendorDoc);
  
  // Create default categories
  const defaultCategories = [
    {
      name: 'Peruspesu',
      description: 'Peruspesut ja pikapesut',
      icon: 'car',
      order: 1,
      vendorId
    },
    {
      name: 'Sisäpesu',
      description: 'Auton sisätilojen puhdistus',
      icon: 'armchair',
      order: 2,
      vendorId
    },
    {
      name: 'Premium',
      description: 'Premium-tason pesut ja käsittelyt',
      icon: 'star',
      order: 3,
      vendorId
    },
    {
      name: 'Erikoispalvelut',
      description: 'Erikoiskäsittelyt ja lisäpalvelut',
      icon: 'sparkles',
      order: 4,
      vendorId
    }
  ];
  
  defaultCategories.forEach(category => {
    const categoryRef = doc(collection(db, COLLECTIONS.SERVICE_CATEGORIES));
    batch.set(categoryRef, {
      ...category,
      id: categoryRef.id,
      createdAt: now,
      updatedAt: now
    });
  });
  
  await batch.commit();
  return vendorId;
};

export const getVendor = async (idOrUserId: string): Promise<Vendor | null> => {
  try {
    // First try to find vendor by their userId
    const vendorsQuery = query(
      collection(db, COLLECTIONS.VENDORS),
      where('userId', '==', idOrUserId),
      limit(1)
    );
    
    const vendorsSnapshot = await getDocs(vendorsQuery);
    
    if (!vendorsSnapshot.empty) {
      const vendorDoc = vendorsSnapshot.docs[0];
      const vendor = { id: vendorDoc.id, ...vendorDoc.data() } as Vendor;
      
      // Don't return banned vendors
      if (vendor.banned === true) {
        return null;
      }
      return vendor;
    }

    // If not found by userId, try direct id lookup
    const vendorRef = doc(db, COLLECTIONS.VENDORS, idOrUserId);
    const vendorSnap = await getDoc(vendorRef);
    
    if (vendorSnap.exists()) {
      const vendor = { id: vendorSnap.id, ...vendorSnap.data() } as Vendor;
      
      // Don't return banned vendors
      if (vendor.banned === true) {
        return null;
      }
      return vendor;
    }

    return null;
  } catch (error) {
    console.error('Error fetching vendor:', error);
    return null;
  }
};

export const updateVendor = async (vendorId: string, vendorData: Partial<Vendor>) => {
  try {
    const vendorRef = doc(db, COLLECTIONS.VENDORS, vendorId);
    
    await updateDoc(vendorRef, {
      ...vendorData,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error updating vendor:', error);
    throw error;
  }
};

export const getVendorsByService = async (serviceId: string) => {
  const q = query(
    collection(db, COLLECTIONS.VENDORS),
    where('services', 'array-contains', serviceId),
    where('banned', '!=', true), // Exclude banned vendors
    where('verified', '==', true) // Only include verified vendors
  );
  const querySnapshot = await getDocs(q);
  
  // Additional filter to ensure we don't show banned vendors
  return querySnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }) as Vendor)
    .filter(vendor => vendor.banned !== true);
};

export const getDefaultServices = async (vendorId: string): Promise<Service[]> => {
  return DEFAULT_SERVICES.map(service => ({
    ...service,
    id: crypto.randomUUID(),
    vendorId,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
};

// Service operations
export const createService = async (serviceData: Omit<Service, 'id'>) => {
  const serviceRef = doc(collection(db, COLLECTIONS.SERVICES));
  await setDoc(serviceRef, {
    ...serviceData,
    id: serviceRef.id,
    createdAt: serverTimestamp()
  });
  return serviceRef.id;
};

export const updateService = async (serviceId: string, serviceData: Partial<Service>) => {
  const serviceRef = doc(db, COLLECTIONS.SERVICES, serviceId);
  await updateDoc(serviceRef, {
    ...serviceData,
    updatedAt: serverTimestamp()
  });
  return true;
};

export const deleteService = async (serviceId: string) => {
  const serviceRef = doc(db, COLLECTIONS.SERVICES, serviceId);
  await deleteDoc(serviceRef);
  return true;
};

export const getVendorServices = async (vendorId: string) => {
  // First check if the vendor is banned
  const vendorRef = doc(db, COLLECTIONS.VENDORS, vendorId);
  const vendorSnap = await getDoc(vendorRef);
  
  if (!vendorSnap.exists() || vendorSnap.data().banned === true) {
    return []; // Return empty array if vendor doesn't exist or is banned
  }
  
  const q = query(
    collection(db, COLLECTIONS.SERVICES),    where('vendorId', '==', vendorId)
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Service);
};

// Enhanced appointment status update with secure coin reward system
export const updateAppointment = async (appointmentId: string, appointmentData: Partial<Appointment>) => {
  try {
    const appointmentRef = doc(db, COLLECTIONS.APPOINTMENTS, appointmentId);
    const oldAppointmentSnap = await getDoc(appointmentRef);
    
    if (!oldAppointmentSnap.exists()) {
      throw new Error('Appointment not found');
    }
    
    const oldAppointment = oldAppointmentSnap.data() as Appointment;
    
    // Security check: Only award coins when status changes to "completed" (valmis)
    if (appointmentData.status === 'completed' && oldAppointment.status !== 'completed') {
      // Only proceed with coin award if:
      // 1. We have a valid customer ID
      // 2. We have a valid service ID
      // 3. The appointment hasn't been rewarded already
      
      if (!oldAppointment.customerId || !oldAppointment.serviceId) {
        console.error('Invalid appointment data for coin reward', { appointmentId });
        // Continue with updating appointment but skip coin reward
      } else if (oldAppointment.coinRewardProcessed) {
        console.warn('Appointment already processed for coin reward', { appointmentId });
        // Continue with updating appointment but skip coin reward
      } else {
        // Transaction to ensure both operations succeed or fail together
        await runTransaction(db, async (transaction) => {
          // Get service details to check coin reward
          const serviceRef = doc(db, COLLECTIONS.SERVICES, oldAppointment.serviceId);
          const serviceSnap = await transaction.get(serviceRef);
          
          if (!serviceSnap.exists()) {
            throw new Error('Service not found');
          }
          
          const service = serviceSnap.data() as Service;
          const coinReward = service.coinReward || 0;
          
          if (coinReward > 0) {
            // Get user document to update
            const userRef = doc(db, COLLECTIONS.USERS, oldAppointment.customerId);
            const userSnap = await transaction.get(userRef);
            
            if (!userSnap.exists()) {
              throw new Error('User not found');
            }
            
            // Create transaction record
            const coinTransaction: Transaction = {
              id: crypto.randomUUID(),
              amount: coinReward,
              type: 'credit',
              description: `Kolikot palvelusta: ${service.name}`,
              timestamp: Timestamp.now(),
              serviceId: service.id,
              appointmentId: appointmentId
            };
            
            // Update user wallet
            transaction.update(userRef, {
              'wallet.coins': increment(coinReward),
              'wallet.transactions': arrayUnion(coinTransaction)
            });
            
            // Mark appointment as rewarded
            transaction.update(appointmentRef, {
              ...appointmentData,
              coinRewardProcessed: true,
              coinRewardAmount: coinReward,
              coinRewardTimestamp: Timestamp.now(),
              updatedAt: serverTimestamp()
            });
          } else {
            // No coins to award, just update the appointment
            transaction.update(appointmentRef, {
              ...appointmentData,
              coinRewardProcessed: true,
              coinRewardAmount: 0,
              updatedAt: serverTimestamp()
            });
          }
        });
        
        // Transaction completed successfully
        return true;
      }
    }
    
    // For non-completed status updates or already processed rewards,
    // just update the appointment normally
    await updateDoc(appointmentRef, {
      ...appointmentData,
      updatedAt: serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error('Error updating appointment:', error);
    throw error;
  }
};

// Enhanced appointment creation with coin usage
export const createAppointment = async (
  appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>,
  coinsToUse: number = 0
) => {
  const appointmentRef = doc(collection(db, COLLECTIONS.APPOINTMENTS));

  try {
    // Check if vendor is banned before creating appointment
    const vendorRef = doc(db, COLLECTIONS.VENDORS, appointmentData.vendorId);
    const vendorSnap = await getDoc(vendorRef);
    
    if (!vendorSnap.exists() || vendorSnap.data().banned === true) {
      throw new Error('Palveluntarjoaja ei ole enää saatavilla');
    }

    const now = Timestamp.now();
    const appointmentDate = Timestamp.fromDate(appointmentData.date);

    // Create base appointment data
    const baseAppointmentData = {
      ...appointmentData,
      id: appointmentRef.id,
      date: appointmentDate,
      createdAt: now,
      updatedAt: now,
      coinsUsed: coinsToUse,
      status: 'confirmed',
      coinRewardProcessed: false // Initialize as not processed for reward
    };

    if (coinsToUse > 0) {
      // Validate coin usage in a transaction
      await runTransaction(db, async (transaction) => {
        // Get user's current coin balance
        const userRef = doc(db, COLLECTIONS.USERS, appointmentData.customerId);
        const userSnap = await transaction.get(userRef);
        
        if (!userSnap.exists()) {
          throw new Error('Käyttäjää ei löydy');
        }
        
        const userData = userSnap.data();
        const currentCoins = userData.wallet?.coins || 0;
        
        // Verify user has enough coins
        if (currentCoins < coinsToUse) {
          throw new Error('Ei tarpeeksi kolikoita');
        }
        
        // Create transaction record
        const coinTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount: -coinsToUse,
          type: 'debit',
          description: 'Kolikot käytetty alennukseen',
          timestamp: now,
          appointmentId: appointmentRef.id
        };
        
        // Update user wallet
        transaction.update(userRef, {
          'wallet.coins': increment(-coinsToUse),
          'wallet.transactions': arrayUnion(coinTransaction)
        });
        
        // Create the appointment
        transaction.set(appointmentRef, baseAppointmentData);
      });
    } else {
      // No coins used, just create the appointment
      await setDoc(appointmentRef, baseAppointmentData);
    }

    // Send confirmation emails
    try {
      const vendor = await getVendor(appointmentData.vendorId);
      if (vendor) {
        await Promise.all([
          sendAppointmentConfirmation(baseAppointmentData as Appointment, vendor),
          sendVendorNotification(vendor, 'Uusi varaus', `Uusi varaus tehty: ${baseAppointmentData.id}`)
        ]);
      }
    } catch (error) {
      console.error('Error sending confirmation emails:', error);
      // Don't throw error to avoid blocking appointment creation
    }

    return appointmentRef.id;
  } catch (error) {
    console.error('Error creating appointment:', error);
    throw error;
  }
};

export const getCustomerAppointments = async (customerId: string) => {
  const q = query(
    collection(db, COLLECTIONS.APPOINTMENTS),
    where('customerId', '==', customerId),
    orderBy('date', 'desc')
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Appointment);
};

export const getVendorAppointments = async (vendorId: string) => {
  // First check if the vendor is banned
  const vendorRef = doc(db, COLLECTIONS.VENDORS, vendorId);
  const vendorSnap = await getDoc(vendorRef);
  
  if (!vendorSnap.exists() || vendorSnap.data().banned === true) {
    return []; // Return empty array if vendor doesn't exist or is banned
  }
  
  const q = query(
    collection(db, COLLECTIONS.APPOINTMENTS),
    where('vendorId', '==', vendorId),
    orderBy('date', 'desc')
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Appointment);
};

// Support ticket operations
export const createSupportTicket = async (ticketData: Omit<SupportTicket, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => {
  const ticketRef = doc(collection(db, COLLECTIONS.SUPPORT_TICKETS));
  await setDoc(ticketRef, {
    ...ticketData,
    id: ticketRef.id,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ticketRef.id;
};

export const getUserSupportTickets = async (userId: string) => {
  const q = query(
    collection(db, COLLECTIONS.SUPPORT_TICKETS),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as SupportTicket);
};

export const addTicketResponse = async (ticketId: string, response: { userId: string; userRole: string; message: string }) => {
  const ticketRef = doc(db, COLLECTIONS.SUPPORT_TICKETS, ticketId);
  const responseData = {
    id: crypto.randomUUID(),
    ...response,
    createdAt: Timestamp.now()
  };
  
  await updateDoc(ticketRef, {
    responses: arrayUnion(responseData),
    updatedAt: serverTimestamp()
  });
  return responseData;
};

export const closeSupportTicket = async (ticketId: string) => {
  const ticketRef = doc(db, COLLECTIONS.SUPPORT_TICKETS, ticketId);
  await updateDoc(ticketRef, {
    status: 'closed',
    updatedAt: serverTimestamp()
  });
  return true;
};

export const getAllSupportTickets = async () => {
  const q = query(
    collection(db, COLLECTIONS.SUPPORT_TICKETS),
    orderBy('createdAt', 'desc')
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};
