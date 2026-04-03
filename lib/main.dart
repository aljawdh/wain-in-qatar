import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:exif/exif.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:tflite_flutter/tflite_flutter.dart';
import 'package:url_launcher/url_launcher_string.dart';

import 'firebase_options.dart';

const String openWeatherApiKey = String.fromEnvironment('OPENWEATHER_API_KEY');
const String _stormglassRapidApiKey = 'e663aa2aebmshff90f3814f76f50p1f39adjsnc7454c633095';
const String _stormglassRapidApiHost = 'stormglass.p.rapidapi.com';
const Duration weatherRefreshInterval = Duration(minutes: 10);

enum WeatherCondition {
  clear,
  clouds,
  rain,
  drizzle,
  thunderstorm,
  mist,
  snow,
  unknown,
}

class TidePoint {
  final DateTime time;
  final double level;

  const TidePoint({required this.time, required this.level});
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await FirebaseAuth.instance.signInAnonymously();
  runApp(const NaviDurApp());
}

class NaviDurApp extends StatelessWidget {
  const NaviDurApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'NaviDur - نافـي دور',
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.teal,
        scaffoldBackgroundColor: const Color(0xFF04172b),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF04233b),
          centerTitle: true,
        ),
        textTheme: const TextTheme(
          bodyLarge: TextStyle(fontSize: 18, height: 1.4),
          bodyMedium: TextStyle(fontSize: 16, height: 1.4),
          headlineSmall: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
      ),
      builder: (context, child) {
        return LayoutBuilder(
          builder: (context, constraints) {
            final double appWidth =
                constraints.maxWidth > 450 ? 450 : constraints.maxWidth;
            return ColoredBox(
              color: const Color(0xFF010a12),
              child: Center(
                child: SizedBox(
                  width: appWidth,
                  height: constraints.maxHeight,
                  child: child!,
                ),
              ),
            );
          },
        );
      },
      home: const Directionality(
        textDirection: TextDirection.rtl,
        child: HomeScreen(),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;
  Timer? _weatherTimer;

  bool isMarineMode = true;
  bool isLoading = false;
  String weatherSummary = 'جارٍ التحميل...';
  String temperatureText = '--°';
  String windText = '-- كم/س';
  String _windDirectionLabel = 'غير معروف';
  WeatherCondition _weatherCondition = WeatherCondition.unknown;
  double _windSpeedKmh = 0;
  double _windDegree = 0;
  List<TidePoint> _tideForecast = const [];
  String _highestTideLabel = '--';
  String _lowestTideLabel = '--';
  String classificationResult = 'لم يتم تصنيف الصورة بعد';
  String rewardCoupon = 'لم تحصل بعد';
  int verifiedCatchCount = 0;

  String latestLocationLabel = 'لم يتم تسجيل موقع بعد';
  double wheelAngle = 0;
  double? lastLatitude;
  double? lastLongitude;
  User? currentUser;
  String lastImageUrl = '';

  static const List<String> marineMonths = [
    'محرم',
    'صفر',
    'ربيع الأول',
    'ربيع الآخر',
    'جمادى الأولى',
    'جمادى الآخرة',
    'رجب',
    'شعبان',
    'رمضان',
    'شوال',
    'ذو القعدة',
    'ذو الحجة',
  ];

  static const List<String> agriculturalMonths = [
    'شتاء البذار',
    'ربيع النمو',
    'صيف النهاية',
    'خريف الحصاد',
    'ري وتسميد',
    'قطاف وتخزين',
  ];

  @override
  void initState() {
    super.initState();
    _initializeApp();
    _startWeatherAutoRefresh();
  }

  @override
  void dispose() {
    _weatherTimer?.cancel();
    super.dispose();
  }

  Future<void> _initializeApp() async {
    setState(() => isLoading = true);
    await _ensureUser();
    wheelAngle = _computeWheelAngle();
    await _fetchWeather();
    await Future.wait([_fetchStormglassData(), _fetchVerifiedCatchCount()]);
    setState(() => isLoading = false);
  }

  void _startWeatherAutoRefresh() {
    _weatherTimer?.cancel();
    _weatherTimer = Timer.periodic(weatherRefreshInterval, (_) async {
      await _fetchWeather();
      await _fetchStormglassData();
    });
  }

  Future<void> _ensureUser() async {
    currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser == null) {
      final credential = await FirebaseAuth.instance.signInAnonymously();
      currentUser = credential.user;
    }
    if (currentUser != null) {
      await _firestore.collection('users').doc(currentUser!.uid).set(
        {
          'uid': currentUser!.uid,
          'mode': isMarineMode ? 'بحري' : 'زراعي',
          'updatedAt': FieldValue.serverTimestamp(),
        },
        SetOptions(merge: true),
      );
    }
  }

  double _computeWheelAngle() {
    final today = DateTime.now();
    var anchor = DateTime(today.year, 8, 15);
    if (today.isBefore(anchor)) {
      anchor = DateTime(today.year - 1, 8, 15);
    }
    final daysSinceAnchor = today.difference(anchor).inDays;
    return (daysSinceAnchor % 365) * 2 * pi / 365;
  }

  String _windDirection(int degrees) {
    const directions = [
      'شمالية',
      'شمالية شرقية',
      'شرقية',
      'جنوبية شرقية',
      'جنوبية',
      'جنوبية غربية',
      'غربية',
      'شمالية غربية',
    ];
    final index = ((degrees + 22.5) ~/ 45) % 8;
    return directions[index];
  }

  WeatherCondition _mapWeatherCondition(int weatherCode, String description) {
    final desc = description.toLowerCase();
    if (weatherCode >= 200 && weatherCode < 300) return WeatherCondition.thunderstorm;
    if (weatherCode >= 300 && weatherCode < 400) return WeatherCondition.drizzle;
    if (weatherCode >= 500 && weatherCode < 600) return WeatherCondition.rain;
    if (weatherCode >= 600 && weatherCode < 700) return WeatherCondition.snow;
    if (weatherCode >= 700 && weatherCode < 800) return WeatherCondition.mist;
    if (weatherCode == 800) return WeatherCondition.clear;
    if (weatherCode > 800 && weatherCode < 900) return WeatherCondition.clouds;
    if (desc.contains('rain') || desc.contains('مطر') || desc.contains('أمطار')) {
      return WeatherCondition.rain;
    }
    return WeatherCondition.unknown;
  }

  IconData _weatherConditionIcon(WeatherCondition condition) {
    switch (condition) {
      case WeatherCondition.rain:
        return Icons.grain;
      case WeatherCondition.drizzle:
        return Icons.water_drop;
      case WeatherCondition.thunderstorm:
        return Icons.thunderstorm;
      case WeatherCondition.clouds:
        return Icons.cloud;
      case WeatherCondition.clear:
        return Icons.wb_sunny;
      case WeatherCondition.snow:
        return Icons.ac_unit;
      case WeatherCondition.mist:
        return Icons.foggy;
      case WeatherCondition.unknown:
        return Icons.waves;
    }
  }

  String _weatherConditionLabel(WeatherCondition condition) {
    switch (condition) {
      case WeatherCondition.rain:
        return 'أمطار';
      case WeatherCondition.drizzle:
        return 'رذاذ';
      case WeatherCondition.thunderstorm:
        return 'عاصفة رعدية';
      case WeatherCondition.clouds:
        return 'غائم';
      case WeatherCondition.clear:
        return 'صحو';
      case WeatherCondition.snow:
        return 'ثلوج';
      case WeatherCondition.mist:
        return 'ضباب';
      case WeatherCondition.unknown:
        return 'غير محدد';
    }
  }

  Future<void> _fetchStormglassData() async {
    debugPrint('⚓ [Stormglass] _fetchStormglassData() called — lat=$lastLatitude lng=$lastLongitude');
    try {
      final lat = lastLatitude ?? 25.2854;
      final lng = lastLongitude ?? 51.5310;
      final now = DateTime.now().toUtc();
      final end = now.add(const Duration(hours: 24));
      final uri = Uri.https(
        _stormglassRapidApiHost,
        '/forecast',
        {
          'lat': lat.toStringAsFixed(6),
          'lng': lng.toStringAsFixed(6),
          'params': 'windSpeed,windDirection,seaLevel',
          'start': now.toIso8601String(),
          'end': end.toIso8601String(),
        },
      );
      debugPrint('⚓ [Stormglass] GET $uri');
      final response = await http.get(
        uri,
        headers: {
          'x-rapidapi-key': _stormglassRapidApiKey,
          'x-rapidapi-host': _stormglassRapidApiHost,
        },
      );
      debugPrint('⚓ [Stormglass] status=${response.statusCode}');
      if (response.statusCode != 200) {
        debugPrint('⚓ [Stormglass] ERROR body=${response.body}');
        return;
      }
      debugPrint('⚓ [Stormglass] raw response (first 300 chars): ${response.body.substring(0, response.body.length.clamp(0, 300))}');
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final hours = body['hours'] as List?;
      debugPrint('⚓ [Stormglass] hours count=${hours?.length ?? 0}');
      if (hours == null || hours.isEmpty) return;

      final tidePoints = <TidePoint>[];
      double? sgWindSpeed;
      double? sgWindDir;

      for (final entry in hours) {
        final h = entry as Map<String, dynamic>;
        final timeStr = h['time'] as String?;
        if (timeStr == null) continue;
        final time = DateTime.tryParse(timeStr)?.toLocal();
        if (time == null) continue;

        // Sea level / tide
        final seaLevelMap = h['seaLevel'] as Map<String, dynamic>?;
        final tideMap = h['tide'] as Map<String, dynamic>?;
        final rawLevel = seaLevelMap?['sg']
            ?? tideMap?['sg']
            ?? seaLevelMap?['noaa']
            ?? tideMap?['noaa'];
        final level = (rawLevel as num?)?.toDouble() ?? 0.0;
        tidePoints.add(TidePoint(time: time, level: level));

        // Capture first hour's wind as current conditions
        if (sgWindSpeed == null) {
          final wsMap = h['windSpeed'] as Map<String, dynamic>?;
          final wdMap = h['windDirection'] as Map<String, dynamic>?;
          sgWindSpeed = ((wsMap?['sg'] ?? wsMap?['noaa']) as num?)?.toDouble();
          sgWindDir = ((wdMap?['sg'] ?? wdMap?['noaa']) as num?)?.toDouble();
        }
      }

      debugPrint('⚓ [Stormglass] tidePoints parsed=${tidePoints.length}, sgWindSpeed=$sgWindSpeed, sgWindDir=$sgWindDir');
      if (tidePoints.isEmpty) return;

      final highest = tidePoints.reduce((a, b) => a.level >= b.level ? a : b);
      final lowest = tidePoints.reduce((a, b) => a.level <= b.level ? a : b);
      debugPrint('⚓ [Stormglass] highTide=${highest.level.toStringAsFixed(2)}m @ ${highest.time}  lowTide=${lowest.level.toStringAsFixed(2)}m @ ${lowest.time}');

      setState(() {
        _tideForecast = tidePoints;
        _highestTideLabel = _formatTideLabel('أعلى مد', highest);
        _lowestTideLabel = _formatTideLabel('أدنى جزر', lowest);
        if (sgWindSpeed != null) {
          final kmh = sgWindSpeed! * 3.6;
          _windSpeedKmh = kmh;
          windText = '${kmh.toStringAsFixed(1)} كم/س';
        }
        if (sgWindDir != null) {
          _windDegree = sgWindDir!;
          _windDirectionLabel = _windDirection(sgWindDir!.toInt());
        }
      });
    } catch (error) {
      debugPrint('⚓ [Stormglass] EXCEPTION: $error');
    }
  }

  String _formatHour(DateTime time) {
    final h = time.hour.toString().padLeft(2, '0');
    return '$h:00';
  }

  String _formatTideLabel(String prefix, TidePoint point) {
    return '$prefix ${_formatHour(point.time)} (${point.level.toStringAsFixed(2)} م)';
  }

  Future<void> _fetchWeather() async {
    debugPrint('🌤 [Weather] _fetchWeather() called');
    try {
      final permission = await Permission.locationWhenInUse.request();
      if (!permission.isGranted) {
        setState(() {
          weatherSummary = 'لم يتم منح إذن الموقع';
          temperatureText = '--°';
          windText = '-- كم/س';
          _weatherCondition = WeatherCondition.unknown;
        });
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      lastLatitude = position.latitude;
      lastLongitude = position.longitude;
      final uri = Uri.parse(
        'https://api.openweathermap.org/data/2.5/weather?lat=${position.latitude}&lon=${position.longitude}&appid=$openWeatherApiKey&units=metric&lang=ar',
      );
      final response = await http.get(uri);
      if (response.statusCode != 200) {
        throw StateError('فشل استدعاء الطقس');
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final weatherInfo = (data['weather'] as List).first as Map<String, dynamic>;
      final weather = weatherInfo['description']?.toString() ?? 'غير متوفر';
      final weatherCode = (weatherInfo['id'] as num?)?.toInt() ?? 0;
      final temp = (data['main']?['temp'] as num?)?.toDouble() ?? 0;
      final windSpeedMs = (data['wind']?['speed'] as num?)?.toDouble() ?? 0;
      final windSpeedKmh = windSpeedMs * 3.6;
      final windDeg = (data['wind']?['deg'] as num?)?.toInt() ?? 0;
      final condition = _mapWeatherCondition(weatherCode, weather);
      setState(() {
        weatherSummary = weather;
        temperatureText = '${temp.toInt()}°';
        // Wind from OWM is a fallback; Stormglass will override after this call.
        windText = '${windSpeedKmh.toStringAsFixed(1)} كم/س';
        _windSpeedKmh = windSpeedKmh;
        _windDegree = windDeg.toDouble();
        _windDirectionLabel = _windDirection(windDeg);
        _weatherCondition = condition;
      });
    } catch (error) {
      debugPrint('Weather fetch error: $error');
      setState(() {
        weatherSummary = 'فشل تحميل الطقس';
        temperatureText = '--°';
        windText = '-- كم/س';
        _windSpeedKmh = 0;
        _windDegree = 0;
        _windDirectionLabel = 'غير متوفر';
        _weatherCondition = WeatherCondition.unknown;
      });
    }
  }

  Future<void> _fetchVerifiedCatchCount() async {
    try {
      if (currentUser == null) return;
      final query = await _firestore
          .collection('posts')
          .where('userId', isEqualTo: currentUser!.uid)
          .get();
      final count = query.docs.length;
      String coupon = rewardCoupon;
      if (count >= 1000 && rewardCoupon == 'لم تحصل بعد') {
        coupon = 'COUPON-WAIN-${DateTime.now().year}';
        await _firestore.collection('users').doc(currentUser!.uid).set(
          {
            'rewardCoupon': coupon,
            'verifiedCatchCount': count,
            'rewardGrantedAt': FieldValue.serverTimestamp(),
          },
          SetOptions(merge: true),
        );
      }
      setState(() {
        verifiedCatchCount = count;
        rewardCoupon = coupon;
      });
    } catch (error) {
      debugPrint('Catch counter error: $error');
    }
  }

  String get _currentModeLabel => isMarineMode ? 'بحري' : 'زراعي';

  List<Map<String, String>> get _seasonCards {
    if (isMarineMode) {
      return [
        {'icon': '🐟', 'title': 'موسم الصيد', 'value': 'الأسماك البحرية'},
        {'icon': '🌊', 'title': 'شهر الصيد', 'value': marineMonths[DateTime.now().month - 1]},
        {'icon': '🧭', 'title': 'الدر', 'value': 'محسوب بناءً على تاريخ اليوم'},
      ];
    }
    return [
      {'icon': '🌿', 'title': 'موسم الزرع', 'value': 'المحاصيل الموسمية'},
      {'icon': '☀️', 'title': 'شهر الزراعة', 'value': agriculturalMonths[DateTime.now().month % agriculturalMonths.length]},
      {'icon': '🚜', 'title': 'الدر', 'value': 'مربوط بتاريخ حصاد الأرض'},
    ];
  }

  Future<void> _uploadImage() async {
    if (currentUser == null) return;
    try {
      final cameraStatus = await Permission.camera.request();
      final photosStatus = await Permission.photos.request();
      final storageStatus = await Permission.storage.request();
      if (!cameraStatus.isGranted && !photosStatus.isGranted && !storageStatus.isGranted) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('يرجى منح إذن الكاميرا أو الصور للوصول للصورة')),
          );
        }
        return;
      }
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
      if (picked == null) return;
      setState(() => isLoading = true);
      final bytes = await picked.readAsBytes();
      final metadataResult = await _extractImageMetadata(bytes);
      final classification = await _classifyImage(bytes);

      final uploadRef = _storage.ref().child('user_uploads/${currentUser!.uid}/${DateTime.now().millisecondsSinceEpoch}.jpg');
      final uploadTask = uploadRef.putData(
        bytes,
        SettableMetadata(
          contentType: 'image/jpeg',
          customMetadata: {
            'mode': _currentModeLabel,
            'classification': classification,
          },
        ),
      );
      final snapshot = await uploadTask.whenComplete(() {});
      final imageUrl = await snapshot.ref.getDownloadURL();
      final gps = metadataResult['gps'] as Map<String, dynamic>?;
      if (gps != null) {
        lastLatitude = gps['latitude'] as double?;
        lastLongitude = gps['longitude'] as double?;
        latestLocationLabel = 'إحداثيات: ${lastLatitude?.toStringAsFixed(5)}, ${lastLongitude?.toStringAsFixed(5)}';
        await _firestore.collection('locations').add({
          'userId': currentUser!.uid,
          'mode': _currentModeLabel,
          'latitude': lastLatitude,
          'longitude': lastLongitude,
          'title': _currentModeLabel == 'بحري' ? 'موقع صيد بحري' : 'موقع زراعي',
          'imageUrl': imageUrl,
          'capturedAt': metadataResult['date'] ?? FieldValue.serverTimestamp(),
          'createdAt': FieldValue.serverTimestamp(),
        });
      }

      await _firestore.collection('posts').add({
        'userId': currentUser!.uid,
        'mode': _currentModeLabel,
        'imageUrl': imageUrl,
        'classification': classification,
        'metadata': metadataResult,
        'description': isMarineMode ? 'صيد بحري موثق' : 'محصول زراعي موثق',
        'createdAt': FieldValue.serverTimestamp(),
      });

      await _firestore.collection('users').doc(currentUser!.uid).set(
        {
          'lastPostAt': FieldValue.serverTimestamp(),
          'lastImageUrl': imageUrl,
          'classification': classification,
        },
        SetOptions(merge: true),
      );

      await _fetchVerifiedCatchCount();
      setState(() {
        classificationResult = classification;
        lastImageUrl = imageUrl;
      });
    } catch (error) {
      debugPrint('Upload error: $error');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('حدث خطأ أثناء الرفع: $error')),
        );
      }
    } finally {
      setState(() => isLoading = false);
    }
  }

  Future<Map<String, dynamic>> _extractImageMetadata(Uint8List bytes) async {
    if (kIsWeb) {
      return {'gps': null, 'date': null};
    }
    try {
      final tags = (await readExifFromBytes(bytes)) ?? {};
      final gpsLatitude = tags['GPS GPSLatitude']?.printable;
      final gpsLongitude = tags['GPS GPSLongitude']?.printable;
      final gpsLatRef = tags['GPS GPSLatitudeRef']?.printable;
      final gpsLonRef = tags['GPS GPSLongitudeRef']?.printable;
      final imageDate = tags['Image DateTime']?.printable ?? tags['DateTime']?.printable;
      final latitude = _parseGpsCoordinate(gpsLatitude, gpsLatRef);
      final longitude = _parseGpsCoordinate(gpsLongitude, gpsLonRef);
      DateTime? parsedDate;
      if (imageDate != null) {
        parsedDate = _parseExifDate(imageDate);
      }
      return {
        'gps': latitude != null && longitude != null
            ? {'latitude': latitude, 'longitude': longitude}
            : null,
        'date': parsedDate?.toIso8601String(),
        'raw': {
          'date': imageDate,
          'gpsLatitude': gpsLatitude,
          'gpsLongitude': gpsLongitude,
        },
      };
    } catch (error) {
      debugPrint('Metadata error: $error');
      return {'gps': null, 'date': null};
    }
  }

  double? _parseGpsCoordinate(String? raw, String? ref) {
    if (raw == null) return null;
    final parts = raw.replaceAll('[', '').replaceAll(']', '').split(',');
    if (parts.length < 3) return null;
    try {
      double parsePart(String part) {
        final numbers = part.trim().split('/');
        if (numbers.length == 2) {
          final numerator = double.tryParse(numbers[0]) ?? 0;
          final denominator = double.tryParse(numbers[1]) ?? 1;
          return numerator / denominator;
        }
        return double.tryParse(part.trim()) ?? 0;
      }

      final degrees = parsePart(parts[0]);
      final minutes = parsePart(parts[1]);
      final seconds = parsePart(parts[2]);
      final value = degrees + minutes / 60 + seconds / 3600;
      return (ref?.toUpperCase() == 'S' || ref?.toUpperCase() == 'W') ? -value : value;
    } catch (_) {
      return null;
    }
  }

  DateTime? _parseExifDate(String raw) {
    try {
      final normalized = raw.replaceFirst(':', '-', 0).replaceFirst(':', '-', 5);
      return DateTime.parse(normalized);
    } catch (_) {
      return null;
    }
  }

  Future<String> _classifyImage(Uint8List bytes) async {
    if (kIsWeb) {
      return 'تصنيف الصور يعمل على أندرويد و iOS فقط';
    }
    try {
      final interpreter = await Interpreter.fromAsset('model.tflite');
      final inputTensor = interpreter.getInputTensor(0);
      final shape = inputTensor.shape;
      interpreter.close();
      return 'نموذج TF Lite جاهز (${shape.join('x')})';
    } catch (error) {
      debugPrint('TFLite error: $error');
      return 'لم يتم تحميل نموذج التصنيف بعد';
    }
  }

  Future<void> _saveCurrentLocation() async {
    try {
      final permission = await Permission.locationWhenInUse.request();
      if (!permission.isGranted) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('يرجى منح إذن الموقع للحفظ في Firebase')),
          );
        }
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      lastLatitude = position.latitude;
      lastLongitude = position.longitude;
      latestLocationLabel = 'الموقع الحالي محفوظ: ${position.latitude.toStringAsFixed(5)}, ${position.longitude.toStringAsFixed(5)}';

      if (currentUser != null) {
        await _firestore.collection('locations').add({
          'userId': currentUser!.uid,
          'mode': _currentModeLabel,
          'latitude': position.latitude,
          'longitude': position.longitude,
          'title': 'الموقع الحالي للمستخدم',
          'createdAt': FieldValue.serverTimestamp(),
        });
        await _firestore.collection('users').doc(currentUser!.uid).set(
          {
            'lastKnownLatitude': position.latitude,
            'lastKnownLongitude': position.longitude,
            'lastLocationSavedAt': FieldValue.serverTimestamp(),
          },
          SetOptions(merge: true),
        );
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم حفظ الموقع الحالي في Firebase بنجاح')),
        );
      }
    } catch (error) {
      debugPrint('Location save error: $error');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('فشل حفظ الموقع: $error')),
        );
      }
    }
  }

  Future<void> _launchMaps() async {
    final latitude = lastLatitude ?? 25.2854;
    final longitude = lastLongitude ?? 51.5310;
    final googleMapsUrl = 'google.navigation:q=$latitude,$longitude&mode=d';
    final browserUrl = 'https://www.google.com/maps/dir/?api=1&destination=$latitude,$longitude';
    if (await canLaunchUrlString(googleMapsUrl)) {
      await launchUrlString(googleMapsUrl, mode: LaunchMode.externalApplication);
    } else if (await canLaunchUrlString(browserUrl)) {
      await launchUrlString(browserUrl, mode: LaunchMode.externalApplication);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('لا يمكن فتح تطبيق الخرائط حالياً')),
        );
      }
    }
  }

  void _toggleMode(bool value) {
    setState(() {
      isMarineMode = value;
    });
    if (currentUser != null) {
      _firestore.collection('users').doc(currentUser!.uid).set(
        {
          'mode': _currentModeLabel,
          'updatedAt': FieldValue.serverTimestamp(),
        },
        SetOptions(merge: true),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NaviDur - نافـي دور'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person),
            tooltip: 'بروفايل',
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (context) => ProfilePage(userId: currentUser?.uid)));
            },
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12.0),
            child: Row(
              children: [
                const Icon(Icons.water),
                Switch(
                  value: isMarineMode,
                  onChanged: _toggleMode,
                  activeThumbColor: Colors.tealAccent,
                ),
                const Icon(Icons.local_florist),
              ],
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          Positioned.fill(
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topRight,
                  end: Alignment.bottomLeft,
                  colors: [Color(0xFF02101f), Color(0xFF042e48)],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14.0, vertical: 10.0),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _buildWeatherCard(),
                    const SizedBox(height: 14),
                    _buildTideForecastCard(),
                    const SizedBox(height: 14),
                    _buildWheelCard(),
                    const SizedBox(height: 14),
                    _buildModeSummaryCard(),
                    const SizedBox(height: 14),
                    _buildStatusCards(),
                    const SizedBox(height: 14),
                    _buildActionButtons(),
                    const SizedBox(height: 14),
                    _buildResultCard(),
                    const SizedBox(height: 14),
                    _buildRecentPostsStream(),
                  ],
                ),
              ),
            ),
          ),
          if (isLoading)
            const Positioned.fill(
              child: ColoredBox(
                color: Colors.black38,
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildWeatherCard() {
    final weatherIcon = _weatherConditionIcon(_weatherCondition);
    final weatherLabel = _weatherConditionLabel(_weatherCondition);
    return Card(
      color: const Color(0xFF0b3a55),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(weatherIcon, size: 28, color: Colors.tealAccent),
                const SizedBox(width: 10),
                const Text('بيانات الطقس', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const Spacer(),
                Chip(
                  backgroundColor: const Color(0xFF0b526f),
                  side: BorderSide.none,
                  label: Text(weatherLabel, style: const TextStyle(color: Colors.white)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(weatherSummary, style: const TextStyle(fontSize: 18, color: Colors.white70)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: Text('الحرارة: $temperatureText', style: const TextStyle(fontSize: 16))),
                Expanded(child: Text('الرياح: $windText', style: const TextStyle(fontSize: 16))),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Transform.rotate(
                  angle: _windDegree * (pi / 180),
                  child: const Icon(Icons.navigation, color: Colors.tealAccent, size: 22),
                ),
                const SizedBox(width: 8),
                Text('الاتجاه: $_windDirectionLabel', style: const TextStyle(fontSize: 16, color: Colors.white70)),
              ],
            ),
            const SizedBox(height: 8),
            _buildWindFlowArrows(),
            const SizedBox(height: 4),
            Text(
              'تحديث تلقائي كل 10 دقائق',
              style: const TextStyle(fontSize: 13, color: Colors.white60),
              textAlign: TextAlign.left,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWindFlowArrows() {
    final arrowCount = (_windSpeedKmh / 10).clamp(1, 5).round();
    return SizedBox(
      height: 34,
      child: StreamBuilder<int>(
        stream: Stream<int>.periodic(const Duration(milliseconds: 700), (tick) => tick),
        builder: (context, snapshot) {
          final tick = (snapshot.data ?? 0).toDouble();
          final phase = sin(tick * 0.9);
          final angle = _windDegree * (pi / 180);
          final driftBase = (_windSpeedKmh / 35).clamp(0.2, 1.6) * 14;
          return Row(
            children: List.generate(arrowCount, (index) {
              final distance = driftBase * (index + 1) * 0.35 * phase;
              final offset = Offset(cos(angle) * distance, sin(angle) * distance);
              return Padding(
                padding: const EdgeInsets.only(left: 6.0),
                child: Transform.translate(
                  offset: offset,
                  child: Transform.rotate(
                    angle: angle,
                    child: const Icon(Icons.arrow_forward, color: Colors.tealAccent, size: 18),
                  ),
                ),
              );
            }),
          );
        },
      ),
    );
  }

  Widget _buildTideForecastCard() {
    return Card(
      color: const Color(0xFF0a324d),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(Icons.tsunami, color: Colors.tealAccent),
                SizedBox(width: 8),
                Text('توقعات المد والجزر (24 ساعة)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 10),
            Text(_highestTideLabel, style: const TextStyle(color: Colors.tealAccent, fontSize: 14)),
            const SizedBox(height: 4),
            Text(_lowestTideLabel, style: const TextStyle(color: Colors.orangeAccent, fontSize: 14)),
            const SizedBox(height: 12),
            if (_tideForecast.isEmpty)
              const Text('لا تتوفر بيانات المد والجزر حالياً', style: TextStyle(color: Colors.white70))
            else
              SizedBox(
                height: 96,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _tideForecast.map((point) {
                      final isHigh = _highestTideLabel.contains(_formatHour(point.time));
                      final isLow = _lowestTideLabel.contains(_formatHour(point.time));
                      final markerColor = isHigh
                          ? Colors.tealAccent
                          : isLow
                              ? Colors.orangeAccent
                              : Colors.white70;
                      return Container(
                        width: 86,
                        margin: const EdgeInsets.only(left: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                        decoration: BoxDecoration(
                          color: const Color(0xFF083047),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: markerColor.withValues(alpha: 0.55)),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(_formatHour(point.time), style: TextStyle(fontSize: 12, color: markerColor)),
                            Icon(point.level >= 0 ? Icons.north : Icons.south, color: markerColor, size: 18),
                            Text(
                              '${point.level.toStringAsFixed(2)} م',
                              style: const TextStyle(fontSize: 13, color: Colors.white),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildWheelCard() {
    return Card(
      color: const Color(0xFF07223a),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(14.0),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('دائرة الدر الأصلية', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Text('نقطة الصفر: 15 أغسطس', style: const TextStyle(color: Colors.white70)),
              ],
            ),
            const SizedBox(height: 14),
            SizedBox(
              height: 280,
              child: CustomPaint(
                painter: CircleWheelPainter(angle: wheelAngle),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(isMarineMode ? Icons.anchor : Icons.eco, size: 44, color: Colors.tealAccent),
                      const SizedBox(height: 8),
                      Text('الوضع: $_currentModeLabel', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text('زاوية اليوم: ${(wheelAngle * 180 / pi).toStringAsFixed(1)}°', style: const TextStyle(color: Colors.white70)),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildModeSummaryCard() {
    return Card(
      color: const Color(0xFF0d3c56),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('تفاصيل $_currentModeLabel', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: _seasonCards.map((item) {
                return Chip(
                  backgroundColor: const Color(0xFF08324a),
                  avatar: Text(item['icon']!, style: const TextStyle(fontSize: 18)),
                  label: Text('${item['title']}: ${item['value']}', style: const TextStyle(color: Colors.white)),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            Text('أيقونة المود: ${isMarineMode ? 'بحري 🌊' : 'زراعي 🌿'}', style: const TextStyle(fontSize: 16)),
            const SizedBox(height: 6),
            Text('نص الشهور: ${isMarineMode ? marineMonths.join('، ') : agriculturalMonths.join('، ')}', style: const TextStyle(color: Colors.white70)),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusCards() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Card(
            color: const Color(0xFF082c44),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('عداد الصيد', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('$verifiedCatchCount صيد موثق', style: const TextStyle(fontSize: 18)),
                  const SizedBox(height: 8),
                  Text(rewardCoupon == 'لم تحصل بعد' ? 'بعيد عن كوبون المكافأة' : 'كوبونك: $rewardCoupon', style: const TextStyle(color: Colors.tealAccent)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Card(
            color: const Color(0xFF082c44),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('الموقع الأخير', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(latestLocationLabel, style: const TextStyle(fontSize: 16, color: Colors.white70)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildActionButtons() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: ElevatedButton.icon(
                icon: const Icon(Icons.upload_file),
                label: const Text('رفع صورة الصيد'),
                onPressed: isLoading ? null : _uploadImage,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.navigation),
                label: const Text('انطلاق'),
                onPressed: _launchMaps,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ElevatedButton.icon(
          icon: const Icon(Icons.gps_fixed),
          label: const Text('حفظ الموقع الحالي'),
          onPressed: isLoading ? null : _saveCurrentLocation,
        ),
      ],
    );
  }

  Widget _buildResultCard() {
    return Card(
      color: const Color(0xFF0f3f57),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('الذكاء الاصطناعي والتوثيق', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Text('نتيجة التصنيف: $classificationResult', style: const TextStyle(fontSize: 16)),
            const SizedBox(height: 10),
            Text('الصورة الأخيرة: ${lastImageUrl.isEmpty ? 'لا توجد صورة حتى الآن' : 'تم حفظ الصورة بنجاح'}', style: const TextStyle(color: Colors.white70)),
          ],
        ),
      ),
    );
  }

  Widget _buildRecentPostsStream() {
    return Card(
      color: const Color(0xFF082e50),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('آخر المنشورات العامة', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            StreamBuilder<QuerySnapshot>(
              stream: _firestore.collection('posts').orderBy('createdAt', descending: true).limit(3).snapshots(),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
                  return const Text('لا توجد منشورات بعد', style: TextStyle(color: Colors.white70));
                }
                return Column(
                  children: snapshot.data!.docs.map((doc) {
                    final data = doc.data() as Map<String, dynamic>;
                    final createdAt = data['createdAt'] is Timestamp ? (data['createdAt'] as Timestamp).toDate() : null;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.public, color: Colors.tealAccent),
                      title: Text(data['description'] ?? 'منشور عام', style: const TextStyle(color: Colors.white)),
                      subtitle: Text(
                        '${data['mode'] ?? 'عام'} • ${createdAt != null ? '${createdAt.day}/${createdAt.month}/${createdAt.year}' : 'غير معروف'}',
                        style: const TextStyle(color: Colors.white70),
                      ),
                    );
                  }).toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class CircleWheelPainter extends CustomPainter {
  final double angle;
  const CircleWheelPainter({required this.angle});

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = min(size.width, size.height) * 0.38;
    final backgroundPaint = Paint()
      ..color = const Color(0xFF0c4160)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(center, radius + 20, backgroundPaint);

    final ringPaint = Paint()
      ..color = const Color(0xCC64FFDA)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 12;
    canvas.drawCircle(center, radius, ringPaint);

    for (var i = 0; i < 12; i++) {
      final theta = angle + i * pi / 6;
      final start = Offset(center.dx + cos(theta) * (radius - 12), center.dy + sin(theta) * (radius - 12));
      final end = Offset(center.dx + cos(theta) * (radius + 12), center.dy + sin(theta) * (radius + 12));
      canvas.drawLine(
        start,
        end,
        Paint()
          ..color = Colors.white70
          ..strokeWidth = 4,
      );
    }

    for (var i = 0; i < 6; i++) {
      final theta = angle + i * pi / 3;
      final point = Offset(center.dx + cos(theta) * radius, center.dy + sin(theta) * radius);
      canvas.drawCircle(point, 10, Paint()..color = Colors.tealAccent);
    }

    final accentPaint = Paint()
      ..shader = SweepGradient(
        startAngle: 0,
        endAngle: 2 * pi,
        colors: [Colors.tealAccent, Colors.blueAccent, Colors.tealAccent],
      ).createShader(Rect.fromCircle(center: center, radius: radius));
    canvas.drawCircle(center, radius - 22, accentPaint..style = PaintingStyle.stroke..strokeWidth = 6);
  }

  @override
  bool shouldRepaint(covariant CircleWheelPainter oldDelegate) {
    return oldDelegate.angle != angle;
  }
}

class ProfilePage extends StatefulWidget {
  final String? userId;
  const ProfilePage({super.key, this.userId});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  bool isLoading = false;
  String metadataSummary = 'لم يتم رفع صورة بعد';
  String imageUrl = '';

  Future<void> _uploadProfileImage() async {
    try {
      setState(() => isLoading = true);
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      final metadata = await _extractImageMetadata(bytes);
      final uploadRef = FirebaseStorage.instance
          .ref()
          .child('profile_photos/${widget.userId ?? 'unknown'}/${DateTime.now().millisecondsSinceEpoch}.jpg');
      final snapshot = await uploadRef.putData(bytes, SettableMetadata(contentType: 'image/jpeg'));
      final url = await snapshot.ref.getDownloadURL();
      imageUrl = url;
      if (widget.userId != null) {
        await _firestore.collection('profilePhotos').add({
          'userId': widget.userId,
          'imageUrl': url,
          'metadata': metadata,
          'createdAt': FieldValue.serverTimestamp(),
        });
      }
      metadataSummary = _formatMetadata(metadata);
      if (mounted) setState(() {});
    } catch (error) {
      debugPrint('Profile upload error: $error');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('خطأ في رفع صورة البروفايل: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => isLoading = false);
    }
  }

  Future<Map<String, dynamic>> _extractImageMetadata(Uint8List bytes) async {
    try {
      final tags = (await readExifFromBytes(bytes)) ?? {};
      final gpsLatitude = tags['GPS GPSLatitude']?.printable;
      final gpsLongitude = tags['GPS GPSLongitude']?.printable;
      final gpsLatRef = tags['GPS GPSLatitudeRef']?.printable;
      final gpsLonRef = tags['GPS GPSLongitudeRef']?.printable;
      final imageDate = tags['Image DateTime']?.printable ?? tags['DateTime']?.printable;
      final latitude = _parseGpsCoordinate(gpsLatitude, gpsLatRef);
      final longitude = _parseGpsCoordinate(gpsLongitude, gpsLonRef);
      DateTime? parsedDate;
      if (imageDate != null) {
        parsedDate = _parseExifDate(imageDate);
      }
      return {
        'gps': latitude != null && longitude != null ? {'latitude': latitude, 'longitude': longitude} : null,
        'date': parsedDate?.toIso8601String(),
        'raw': {
          'date': imageDate,
          'gpsLatitude': gpsLatitude,
          'gpsLongitude': gpsLongitude,
        },
      };
    } catch (error) {
      debugPrint('Profile EXIF error: $error');
      return {'gps': null, 'date': null, 'raw': {}};
    }
  }

  double? _parseGpsCoordinate(String? raw, String? ref) {
    if (raw == null) return null;
    final parts = raw.replaceAll('[', '').replaceAll(']', '').split(',');
    if (parts.length < 3) return null;
    try {
      double parsePart(String part) {
        final numbers = part.trim().split('/');
        if (numbers.length == 2) {
          final numerator = double.tryParse(numbers[0]) ?? 0;
          final denominator = double.tryParse(numbers[1]) ?? 1;
          return numerator / denominator;
        }
        return double.tryParse(part.trim()) ?? 0;
      }
      final degrees = parsePart(parts[0]);
      final minutes = parsePart(parts[1]);
      final seconds = parsePart(parts[2]);
      final value = degrees + minutes / 60 + seconds / 3600;
      return (ref?.toUpperCase() == 'S' || ref?.toUpperCase() == 'W') ? -value : value;
    } catch (_) {
      return null;
    }
  }

  DateTime? _parseExifDate(String raw) {
    try {
      final normalized = raw.replaceFirst(':', '-', 0).replaceFirst(':', '-', 5);
      return DateTime.parse(normalized);
    } catch (_) {
      return null;
    }
  }

  String _formatMetadata(Map<String, dynamic> metadata) {
    final gps = metadata['gps'] as Map<String, dynamic>?;
    final date = metadata['date'] as String?;
    final buffer = StringBuffer();
    buffer.writeln('تم استخراج البيانات من الصورة:');
    if (date != null) buffer.writeln('التاريخ: $date');
    if (gps != null) {
      buffer.writeln('الإحداثيات: ${gps['latitude']?.toStringAsFixed(5)}, ${gps['longitude']?.toStringAsFixed(5)}');
    } else {
      buffer.writeln('لا توجد بيانات GPS في الصورة');
    }
    return buffer.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('بروفايل المستخدم'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (imageUrl.isNotEmpty)
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Image.network(imageUrl, height: 180, fit: BoxFit.cover),
              ),
            const SizedBox(height: 16),
            Text(metadataSummary, style: const TextStyle(fontSize: 16, color: Colors.white70)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              icon: const Icon(Icons.camera_alt),
              label: const Text('رفع صورة بروفايل وقراءة بيانات EXIF'),
              onPressed: isLoading ? null : _uploadProfileImage,
            ),
            if (isLoading) const Padding(
              padding: EdgeInsets.only(top: 16.0),
              child: Center(child: CircularProgressIndicator()),
            ),
          ],
        ),
      ),
    );
  }
}
