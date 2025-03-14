import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useSupportDialog } from './contexts/SupportContext';
import { getUser } from './lib/db';
import EmailVerificationBanner from './components/EmailVerificationBanner';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import SearchResults from './pages/SearchResults';
import CustomerProfile from './pages/customer/Profile';
import CustomerCoins from './pages/customer/Coins';
import CustomerAppointments from './pages/customer/Appointments';
import VendorDashboard from './pages/VendorDashboard';
import VendorProfile from './pages/VendorProfile';
import VendorSettings from './pages/VendorSettings';
import VendorOffers from './pages/VendorOffers';
import VendorCalendar from './pages/VendorCalendar';
import AdminDashboard from './pages/AdminDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import EmailVerified from './pages/EmailVerified';
import ActionHandler from './pages/auth/ActionHandler';
import NotFound from './pages/NotFound';
import ProtectedRoute from './components/ProtectedRoute';
import MobileNav from './components/MobileNav';
import SupportDialog from './components/SupportDialog';

// Route paths as constants
export const routes = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  EMAIL_VERIFIED: '/email-verified',
  SEARCH_RESULTS: '/search',
  VENDOR_PROFILE: '/vendor/:id',
  VENDOR_DASHBOARD: '/vendor-dashboard',
  VENDOR_CALENDAR: '/vendor-calendar',
  VENDOR_OFFERS: '/vendor-offers',
  VENDOR_SETTINGS: '/vendor-settings',
  CUSTOMER_DASHBOARD: '/customer-dashboard',
  CUSTOMER_BASE: '/customer',
  CUSTOMER_PROFILE: 'profile',
  CUSTOMER_APPOINTMENTS: 'appointments',
  CUSTOMER_COINS: 'coins',
  ADMIN_DASHBOARD: '/admin',
  AUTH_ACTION: '/auth/action',
  NOT_FOUND: '*'
};

const AppRoutes = () => {
  const { currentUser } = useAuth();
  const { showSupportDialog, setShowSupportDialog } = useSupportDialog();
  const location = useLocation();
  const [userRole, setUserRole] = React.useState<string | null>(null);
  const [transitionDirection, setTransitionDirection] = React.useState<'forward' | 'backward'>('forward');
  const prevPathRef = React.useRef(location.pathname);

  // Track navigation direction
  React.useEffect(() => {
    const isForward = location.pathname.length > prevPathRef.current.length;
    setTransitionDirection(isForward ? 'forward' : 'backward');
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  React.useEffect(() => {
    const loadUserRole = async () => {
      if (currentUser) {
        const userData = await getUser(currentUser.uid);
        setUserRole(userData?.role || null);
      }
    };
    loadUserRole();
  }, [currentUser]);

  // Close support dialog when route changes
  React.useEffect(() => {
    setShowSupportDialog(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0">
      <div className="hidden md:block">
        <Navbar />
      </div>
      <EmailVerificationBanner />
      <div className={`page-transition ${transitionDirection}`}>
        <Routes location={location}>
          <Route path={routes.HOME} element={<Home />} />
          <Route path={routes.SEARCH_RESULTS} element={<SearchResults />} />
          <Route path={routes.LOGIN} element={<Login />} />
          <Route path={routes.EMAIL_VERIFIED} element={<EmailVerified />} />
          <Route path={routes.REGISTER} element={<Register />} />
          <Route path={routes.AUTH_ACTION} element={<ActionHandler />} />
          <Route path={routes.VENDOR_PROFILE} element={<VendorProfile />} />
          <Route 
            path={routes.ADMIN_DASHBOARD} 
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={`${routes.CUSTOMER_BASE}/${routes.CUSTOMER_PROFILE}`} 
            element={
              <ProtectedRoute>
                <CustomerProfile />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={`${routes.CUSTOMER_BASE}/${routes.CUSTOMER_COINS}`} 
            element={
              <ProtectedRoute>
                <CustomerCoins />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={`${routes.CUSTOMER_BASE}/${routes.CUSTOMER_APPOINTMENTS}`} 
            element={
              <ProtectedRoute>
                <CustomerAppointments />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={routes.VENDOR_DASHBOARD} 
            element={
              <ProtectedRoute>
                <VendorDashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={routes.VENDOR_OFFERS} 
            element={
              <ProtectedRoute>
                <VendorOffers />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={routes.VENDOR_CALENDAR} 
            element={
              <ProtectedRoute>
                <VendorCalendar />
              </ProtectedRoute>
            } 
          />
          <Route 
            path={routes.VENDOR_SETTINGS} 
            element={
              <ProtectedRoute>
                <VendorSettings />
              </ProtectedRoute>
            } 
          />
          <Route path={routes.NOT_FOUND} element={<NotFound />} />
        </Routes>
      </div>
      <MobileNav />
      
      {showSupportDialog && userRole && (
        <SupportDialog
          isOpen={showSupportDialog}
          onClose={() => setShowSupportDialog(false)}
          userRole={userRole as 'customer' | 'vendor'}
        />
      )}
    </div>
  );
};

export default AppRoutes;
