import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBMa-D4RG2BcJlMU5DtByo69AgSDdzA-AQ",
  authDomain: "customspro-bd062.firebaseapp.com",
  projectId: "customspro-bd062",
  storageBucket: "customspro-bd062.firebasestorage.app",
  messagingSenderId: "1077255576315",
  appId: "1:1077255576315:web:cebf9757d82437d8b66e5e",
  measurementId: "G-5LK8CL2WSZ",
  databaseURL: "https://customspro-bd062-default-rtdb.firebaseio.com" // Standard URL pattern for Firebase RTDB
};

const FIREBASE_STORAGE_BUCKET = firebaseConfig.storageBucket;

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

export { app, auth, db, storage, FIREBASE_STORAGE_BUCKET };
