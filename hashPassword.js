// Utilidad para generar el hash de la contraseña de admin
// Uso: node hashPassword.js tu_contraseña_segura

import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.log('Uso: node hashPassword.js <contraseña>');
  console.log('Ejemplo: node hashPassword.js miClaveSecreta123');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
console.log('\nContraseña:', password);
console.log('Hash (copiar en .env como ADMIN_PASSWORD_HASH):');
console.log(hash);
