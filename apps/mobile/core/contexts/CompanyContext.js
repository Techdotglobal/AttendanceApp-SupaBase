import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getCompany } from '../../features/company/services/companyService';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const { user } = useAuth();
  const [company, setCompany] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadCompany = useCallback(async () => {
    if (!user) {
      setCompany(null);
      setLogoUrl(null);
      return;
    }
    setLoading(true);
    try {
      const data = await getCompany();
      setCompany(data);
      setLogoUrl(data?.logo_url || null);
    } catch (e) {
      console.warn('[CompanyContext] getCompany failed:', e?.message);
      setCompany(null);
      setLogoUrl(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadCompany();
  }, [loadCompany]);

  const refreshCompany = useCallback(async () => {
    await loadCompany();
  }, [loadCompany]);

  const value = {
    company,
    logoUrl,
    loading,
    refreshCompany,
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}

export { CompanyContext };
