import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uxffnpajkhcvtwzsmrcl.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4ZmZucGFqa2hjdnR3enNtcmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM4NjQ2MjYsImV4cCI6MjA1OTQ0MDYyNn0.RhYRMOL7M4W0TO5XAMmEn_8vWslFJPJnEPUGFqmWUSc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
