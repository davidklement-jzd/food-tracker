import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { logGoalChange } from '../lib/goalHistoryWriter';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) fetchProfile(session.user.id);
        else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } else {
      setProfile(data);
    }
    setLoading(false);
  }

  async function signUp(email, password, displayName, inviteCode) {
    const metadata = { display_name: displayName };
    if (inviteCode) metadata.invite_code = inviteCode;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    return { data, error };
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  }

  async function updateProfile(updates, oldProfileSnapshot) {
    if (!session?.user?.id) return { error: { message: 'Nejste přihlášen/a' } };
    // Pokud volající nepředal snapshot starého profilu, použij aktuální stav.
    // Slouží jako starter řádek do goal_history při první úpravě cílů.
    const oldProfile = oldProfileSnapshot ?? profile ?? {};
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id)
      .select()
      .single();
    if (!error && data) {
      setProfile(data);
      await logGoalChange(session.user.id, oldProfile, updates);
    }
    return { data, error };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
    isTrainer: profile?.role === 'trainer',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
