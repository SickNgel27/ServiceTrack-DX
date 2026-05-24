USE servicetrack_dx;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE usuarios;

INSERT INTO usuarios (nombre_completo, usuario, password, rol) VALUES 
('Luis Asesor', 'asesor01', 'distelsa2026', 'ASESOR'),
('Carlos Técnico', 'tecnico01', 'taller2026', 'TECNICO'),
('Ángel Gerente', 'admin01', 'gerencia2026', 'GERENCIA');

SET FOREIGN_KEY_CHECKS = 1;

SELECT * FROM usuarios;
