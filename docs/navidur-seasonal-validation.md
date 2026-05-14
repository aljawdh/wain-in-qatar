# NAVIDUR — التحقق الموسمي لسمات الدر (Marine Monitoring Center)

## الغرض

- سمات الدر في إطار `durur_trait_framework` هي **فرضيات موسمية قابلة للتحقق**، وليست حقائق فيزيائية مؤكدة.
- **مركز الرصد البحري** (`/admin/monitoring`) هو المكان المعتمد لعرض الرصد الحي، ومقارنة Open-Meteo (تجريبي حاليًا) بهذه الفرضيات، وتسجيل النتائج في `navidur_seasonal_validation_history`.
- لا يغيّر هذا المسار **محرك القرار** أو **التوصيات** العامة؛ القيم تُعرض وتُخزَّن للإدارة فقط.

## مصادر البيانات

| المصدر | الدور |
|--------|--------|
| **Open-Meteo** | رصد تجريبي حالي لمقارنة السمات الموسمية داخل مركز الرصد. |
| **Stormglass** | مقارنة مرجعية بين المصادر في نفس المركز فقط — **ليس** مصدر حقيقة وحيد لقرار NAVIDUR. |
| **المحطة الميدانية (مستقبلًا)** | بعد **المعايرة** يمكن دعم الرصد المحلي أو استبداله تدريجيًا؛ لا يُعتمد كـ ground truth قبل `calibration_status = ok` (راجع `data/field_station_schema.json`). |

## المخازن (Stores)

### `durur_trait_framework`

- يُولَّد تلقائيًا من `durur_master` عند أول طلب إذا كان فارغًا.
- كل سمة تبدأ `status: unverified` و`validation_status: pending`.
- عند الضغط على **تحديث بيانات الدر** يُحدَّث: `match_rate`, `validation_years`, `evidence_count`, `evidence_history`, وقوائم المناطق عند توفر `region` في المحطة.

### `navidur_seasonal_validation_history`

- سجل يدوي لكل تشغيل لزر التحديث: سنة، تاريخ، محطة، در، نتائج المطابقة، طبقة الثقة، `source_used: open_meteo` للمقارنة الموسمية.

## حساب `trait_match_score`

- يُحسب في الدالة المستقلة `matchDururTraitsWithMonitoringData()` (ملف `serverless_api/_lib/navidur-durur-trait-matching.js`).
- الصيغة: \(100 \times \frac{\text{matched} + 0.5 \times \text{partial}}{\max(1,\,n_{\text{traits}})}\) مع سقف 100.
- التصنيف: `matched` (تطابق نصي أو مدى `expected_range` إن وُجد)، `partial` (تداخل معنوي للكلمات)، `failed`، `unknown` (نقص بيانات رقمية).

## طبقة الثقة (عرض فقط)

- الحقول: `source_confidence`, `dur_confidence`, `trait_confidence`, `environmental_confidence`, `validation_confidence`.
- **لا تُحقَن** في `navidur-analysis` أو التوصية العامة.

## الهدف على المدى الطويل

- تكرار التحقق سنويًا قد يرفع موثوقية بعض السمات تدريجيًا (استهداف حتى ~90% لسمات محددة بعد عدة مواسم) — هذا هدف تشغيلي وليس ضمانًا آلياً.

## الربط المستقبلي بالمحطة الميدانية

- مخطط الحقول في `data/field_station_schema.json`.
- الـ ingestion غير مفعّل؛ عند التفعيل لاحقًا يجب مسار **معايرة** صريح قبل استخدام القراءات كمرجع قوي للتحقق.
