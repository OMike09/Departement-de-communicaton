-- Options complémentaires de paramétrage :
--  * types de notifications activables ;
--  * rubriques de la vie du département activables ;
--  * durée de conservation des notifications lues et du journal d'audit.
INSERT INTO settings (key, value) VALUES
  ('notification_types', '{"publication":true,"result":true,"timetable":true,"request":true,"message":true}'),
  ('activity_categories', '{"recherche":true,"publication_scientifique":true,"conference":true,"seminaire":true,"atelier":true,"soutenance":true,"partenariat":true,"association":true,"stage":true,"opportunite":true,"autre":true}'),
  ('data_retention_days', '0')
ON CONFLICT (key) DO NOTHING;
