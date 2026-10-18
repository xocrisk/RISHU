-- XOCRISK has one (light) look now; forget any saved theme choice.
UPDATE users SET preferences = preferences - 'theme' WHERE preferences ? 'theme';
