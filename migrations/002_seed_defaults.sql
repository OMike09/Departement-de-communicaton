-- =====================================================================
-- 002 · DONNÉES INITIALES : rôles, permissions, catégories, paramètres
-- Aucun compte, nom de responsable ni donnée académique n'est inventé.
-- =====================================================================

INSERT INTO roles (slug, name, description, permissions, is_system) VALUES
  ('chef', 'Chef de département',
   'Administrateur principal : contrôle général de l''application.',
   '["*"]'::jsonb, TRUE),
  ('secretariat', 'Secrétariat',
   'Publication administrative, documents officiels et traitement des demandes.',
   '["publications.create","publications.manage_all","publications.audience_all","documents.upload","documents.manage","timetables.manage","requests.manage","users.view","stats.personal"]'::jsonb, TRUE),
  ('responsable_niveau', 'Responsable de niveau',
   'Gère les informations du ou des niveaux attribués.',
   '["publications.create","documents.upload","timetables.manage","stats.personal"]'::jsonb, TRUE),
  ('responsable_parcours', 'Responsable de parcours',
   'Gère les informations du ou des parcours attribués.',
   '["publications.create","documents.upload","timetables.manage","stats.personal"]'::jsonb, TRUE),
  ('enseignant', 'Enseignant',
   'Publie cours, supports, consignes et informations pédagogiques.',
   '["publications.create","documents.upload","stats.personal"]'::jsonb, TRUE),
  ('etudiant', 'Étudiant',
   'Consulte les informations, documents, emplois du temps et résultats le concernant.',
   '[]'::jsonb, TRUE),
  ('delegue', 'Délégué de promotion',
   'Rôle complémentaire configurable par le chef de département.',
   '["publications.create","stats.personal"]'::jsonb, TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, color, sort_order) VALUES
  ('Annonce administrative', 'annonce-administrative', '#1f4e79', 10),
  ('Information pédagogique', 'information-pedagogique', '#2e6da4', 20),
  ('Cours et supports', 'cours-supports', '#0f766e', 30),
  ('Examens', 'examens', '#9a3412', 40),
  ('Résultats', 'resultats', '#7c2d12', 50),
  ('Événement', 'evenement', '#6d28d9', 60),
  ('Recherche scientifique', 'recherche-scientifique', '#065f46', 70)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('app_name', 'Département de Communication — Université de Bouaké'),
  ('app_short', 'Département de Communication'),
  ('institution', 'Université de Bouaké'),
  ('presentation', ''),
  ('presentation_extra', ''),
  ('contact_email', ''),
  ('contact_phone', ''),
  ('contact_address', ''),
  ('contact_hours', ''),
  ('logo_file_id', ''),
  ('academic_year', ''),
  ('require_approval', '1'),
  ('registration_open', '1'),
  ('default_signup_role', 'etudiant'),
  ('signup_help', ''),
  ('modules', '{"activities":true,"documents":true,"timetables":true,"results":true,"requests":true,"messages":true,"notifications_sound":true}'),
  ('text_scale_min', '0.9'),
  ('text_scale_max', '1.4'),
  ('demo_mode', '0'),
  ('footer_note', ''),
  ('max_upload_mb', '8'),
  ('source_pdf_note', 'Le document de référence fourni est un cahier technique et ne décrit pas la structure officielle du Département de Communication. Les rubriques Filières, parcours et niveaux doivent être complétées par la direction.')
ON CONFLICT (key) DO NOTHING;
