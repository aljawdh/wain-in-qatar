import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    return defaultTargetPlatform == TargetPlatform.iOS ? ios : android;
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyDUMMY_REPLACE_ME',
    appId: '1:000000000000:web:0000000000000000',
    messagingSenderId: '000000000000',
    projectId: 'wain-in-qatar',
    authDomain: 'wain-in-qatar.firebaseapp.com',
    storageBucket: 'wain-in-qatar.appspot.com',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyDUMMY_REPLACE_ME',
    appId: '1:000000000000:android:0000000000000000',
    messagingSenderId: '000000000000',
    projectId: 'wain-in-qatar',
    storageBucket: 'wain-in-qatar.appspot.com',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDUMMY_REPLACE_ME',
    appId: '1:000000000000:ios:0000000000000000',
    messagingSenderId: '000000000000',
    projectId: 'wain-in-qatar',
    storageBucket: 'wain-in-qatar.appspot.com',
    iosClientId: '000000000000-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com',
    iosBundleId: 'com.example.wain_in_qatar',
  );
}
