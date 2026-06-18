-- 027_announcements_realtime.sql
-- Zapne Supabase Realtime na příjemcích zpráv. Díky tomu klientce naskočí
-- popup okamžitě po odeslání, i když má appku jen na pozadí (nemusí ji
-- zavírat a znovu otevírat). Které řádky klientka dostane, hlídá RLS.
alter publication supabase_realtime add table public.announcement_recipients;
