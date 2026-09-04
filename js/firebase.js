/* Shared Firebase bootstrap — one app instance for the odometer and the cloud library. */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBVqZNnkReib87I4HQgDD1SOy2Ms8rDtho",
  authDomain: "project-406b757a-8717-4cc8-857.firebaseapp.com",
  databaseURL: "https://project-406b757a-8717-4cc8-857-default-rtdb.firebaseio.com",
  projectId: "project-406b757a-8717-4cc8-857",
  storageBucket: "project-406b757a-8717-4cc8-857.firebasestorage.app",
  messagingSenderId: "629212608512",
  appId: "1:629212608512:web:0df8d0a3354557824200e5",
  measurementId: "G-W59CENB0G2"
};

let _app = null, _db = null;
export function getFirebase(){
  if(!_app){
    _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    _db = getDatabase(_app);
  }
  return { app: _app, db: _db };
}
