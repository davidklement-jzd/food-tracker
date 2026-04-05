import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uxffnpajkhcvtwzsmrcl.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4ZmZucGFqa2hjdnR3enNtcmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODM0MTAsImV4cCI6MjA5MDk1OTQxMH0.c-pefEMXF0tMPIUPpN6r-U8KUjAhYZ2n2LB2WOxtGxg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
