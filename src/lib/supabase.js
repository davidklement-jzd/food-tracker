import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uxffnpajkhcvtwzsmrcl.supabase.co';
// Key split to prevent build tools from truncating the long JWT string
const p0 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const p1 = 'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4ZmZucGFqa2hjdnR3enNtcmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODM0MTAsImV4cCI6MjA5MDk1OTQxMH0';
const p2 = 'c-pefEMXF0tMPIUPpN6r-U8KUjAhYZ2n2LB2WOxtGxg';
const supabaseAnonKey = p0 + '.' + p1 + '.' + p2;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
