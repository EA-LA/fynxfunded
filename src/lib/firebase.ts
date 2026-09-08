import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBqBeQVVD46uUaYDZf9EX-VyTpQpYIm7aI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "fynx-c7a28.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "fynx-c7a28",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "fynx-c7a28.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1011050657868",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1011050657868:web:2a2577bc5373307eb05ce9",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-BNE825NW8E",
};

export const isFirebaseConfigured =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.appId;

// Dev-only: log missing keys for debugging
if (import.meta.env.DEV && !isFirebaseConfigured) {
  const required = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"];
  const missing = required.filter((k) => !import.meta.env[k]);
  console.warn("[Firebase] Missing env vars:", missing.join(", "));
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app);
}

export { app, auth, db, functions };
