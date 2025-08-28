// Скопируйте сюда конфиг из консоли Firebase (Настройки проекта → Ваши приложения → Конфигурация)
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdefg123456",
};

// Необязательный визуальный список админов (для UI). Для безопасности используются правила Firestore.
export const FALLBACK_ADMIN_UIDS = [
  // "uid_из_консоли"
];
