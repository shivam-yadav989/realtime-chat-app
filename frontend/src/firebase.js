import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC2JNsiP22aKpbvdVJSyoZhqTxoo9a7D78",
  authDomain: "realtime-chat-app-a3314.firebaseapp.com",
  projectId: "realtime-chat-app-a3314",
  storageBucket: "realtime-chat-app-a3314.firebasestorage.app",
  messagingSenderId: "281372014124",
  appId: "1:281372014124:web:a963ce60d4af1d84ebc389",
  measurementId: "G-17Z36403HZ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { signInWithPopup, signOut };