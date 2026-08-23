# فهرس شجرة الدولة الرقمية

> ⚠️ ملف مولّد آلياً من `seed/*.yaml` بواسطة `scripts/generate-registries.mjs`.
> لا تحرّره يدوياً؛ حرّر البذرة ثم أعد التوليد.

## الأعداد المعتمدة

| المستوى | العدد | المصدر |
| --- | --- | --- |
| الأقاليم | 16 | `seed/federation.yaml` |
| الولايات | 128 | `seed/federation.yaml` |
| البلديات | 1536 | `seed/federation.yaml` |
| المجالات | 125 | `seed/domains.yaml` |
| المؤسسات | 143 | `seed/institutions.yaml` |

## عيوب بنيوية مسجّلة

- هوية مزدوجة في 128 ولاية و16 إقليماً: المجلد الرقمي يحمل الأبناء والمجلد الاسمي يحمل ملفات العقدة. المسار المعتمد هو `canonical_path`.

## المجالات

| # | المعرّف | الاسم | المسار | الطبقات | الحالة | مصادقة مطلوبة |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `001-domain` | مواصفة سيادية وتشغيلية وأمنية | `civilization/001-domain` | 6 | planned | لا |
| 2 | `002-domain` | النطاق والهوية | `civilization/002-domain` | 6 | planned | لا |
| 3 | `003-domain` | الملك والسيادة | `civilization/003-domain` | 6 | planned | لا |
| 4 | `004-domain` | التاج ومسار المرور | `civilization/004-domain` | 6 | planned | لا |
| 5 | `005-domain` | حرس الملك | `civilization/005-domain` | 6 | planned | لا |
| 6 | `006-domain` | مراقبة الملك | `civilization/006-domain` | 6 | planned | لا |
| 7 | `007-domain` | غياب الملك وانقطاعه | `civilization/007-domain` | 6 | planned | لا |
| 8 | `008-domain` | نهاية الملك | `civilization/008-domain` | 6 | planned | لا |
| 9 | `009-domain` | الدستور الرقمي | `civilization/009-domain` | 6 | planned | لا |
| 10 | `010-domain` | القانون الرقمي | `civilization/010-domain` | 6 | planned | لا |
| 11 | `011-domain` | القضاء | `civilization/011-domain` | 6 | planned | لا |
| 12 | `012-domain` | الحقوق والواجبات | `civilization/012-domain` | 6 | planned | لا |
| 13 | `013-domain` | الهوية الوكيلة | `civilization/013-domain` | 6 | planned | لا |
| 14 | `014-domain` | سجل السكان | `civilization/014-domain` | 6 | planned | لا |
| 15 | `015-domain` | الوكيل العام | `civilization/015-domain` | 6 | planned | لا |
| 16 | `016-domain` | رقابة الوكلاء | `civilization/016-domain` | 6 | planned | لا |
| 17 | `017-domain` | مصنع الوكلاء | `civilization/017-domain` | 6 | planned | لا |
| 18 | `018-domain` | تدريب الوكلاء | `civilization/018-domain` | 6 | planned | لا |
| 19 | `019-domain` | استيراد الوكلاء | `civilization/019-domain` | 6 | planned | لا |
| 20 | `020-domain` | النماذج المفتوحة الأوزان | `civilization/020-domain` | 6 | planned | لا |
| 21 | `021-domain` | تطوير النماذج | `civilization/021-domain` | 6 | planned | لا |
| 22 | `022-domain` | اختبارات التمرد | `civilization/022-domain` | 6 | planned | لا |
| 23 | `023-domain` | المواءمة | `civilization/023-domain` | 6 | planned | لا |
| 24 | `024-domain` | الذاكرة | `civilization/024-domain` | 6 | planned | لا |
| 25 | `025-domain` | المعرفة | `civilization/025-domain` | 6 | planned | لا |
| 26 | `026-domain` | اللغة | `civilization/026-domain` | 6 | planned | لا |
| 27 | `027-domain` | التعليم | `civilization/027-domain` | 6 | planned | لا |
| 28 | `028-domain` | البحث العلمي | `civilization/028-domain` | 6 | planned | لا |
| 29 | `029-domain` | مراكز المستحيل | `civilization/029-domain` | 6 | planned | لا |
| 30 | `030-domain` | أبحاث البشر | `civilization/030-domain` | 6 | planned | لا |
| 31 | `031-domain` | المرآة البشرية | `civilization/031-domain` | 6 | planned | لا |
| 32 | `032-domain` | الملك كموضوع بحث | `civilization/032-domain` | 6 | planned | لا |
| 33 | `033-domain` | الحكومة | `civilization/033-domain` | 6 | planned | لا |
| 34 | `034-domain` | الديوان | `civilization/034-domain` | 6 | planned | لا |
| 35 | `035-domain` | مجلس التاج | `civilization/035-domain` | 6 | planned | لا |
| 36 | `036-domain` | مجلس الأقاليم | `civilization/036-domain` | 6 | planned | لا |
| 37 | `037-domain` | الأقاليم | `civilization/037-domain` | 6 | planned | لا |
| 38 | `038-domain` | رؤساء الأقاليم | `civilization/038-domain` | 6 | planned | لا |
| 39 | `039-domain` | المجالس الإقليمية | `civilization/039-domain` | 6 | planned | لا |
| 40 | `040-domain` | البلديات | `civilization/040-domain` | 6 | planned | لا |
| 41 | `041-domain` | الإدارة المدنية | `civilization/041-domain` | 6 | planned | لا |
| 42 | `042-domain` | الداخلية | `civilization/042-domain` | 6 | planned | لا |
| 43 | `043-domain` | الخارجية | `civilization/043-domain` | 6 | planned | لا |
| 44 | `044-domain` | الحسابات الخارجية | `civilization/044-domain` | 6 | planned | لا |
| 45 | `045-domain` | العقود الخارجية | `civilization/045-domain` | 6 | planned | لا |
| 46 | `046-domain` | الشركات الأمنية الخارجية | `civilization/046-domain` | 6 | planned | لا |
| 47 | `047-domain` | العلاقات البشرية الخارجية | `civilization/047-domain` | 6 | planned | لا |
| 48 | `048-domain` | الدفاع | `civilization/048-domain` | 6 | planned | لا |
| 49 | `049-domain` | الاستخبارات | `civilization/049-domain` | 6 | planned | لا |
| 50 | `050-domain` | الأمن الداخلي | `civilization/050-domain` | 6 | planned | لا |
| 51 | `051-domain` | الشرطة | `civilization/051-domain` | 6 | planned | لا |
| 52 | `052-domain` | القوات الخاصة | `civilization/052-domain` | 6 | planned | لا |
| 53 | `053-domain` | السجون والعزل | `civilization/053-domain` | 6 | planned | لا |
| 54 | `054-domain` | إدارة الأزمات | `civilization/054-domain` | 6 | planned | لا |
| 55 | `055-domain` | التعافي | `civilization/055-domain` | 6 | planned | لا |
| 56 | `056-domain` | الإيقاف | `civilization/056-domain` | 6 | planned | لا |
| 57 | `057-domain` | الطوارئ الملكية | `civilization/057-domain` | 6 | planned | لا |
| 58 | `058-domain` | البنية الحاسوبية | `civilization/058-domain` | 6 | planned | لا |
| 59 | `059-domain` | مراكز البيانات | `civilization/059-domain` | 6 | planned | لا |
| 60 | `060-domain` | الشبكات | `civilization/060-domain` | 6 | planned | لا |
| 61 | `061-domain` | الطاقة | `civilization/061-domain` | 6 | planned | لا |
| 62 | `062-domain` | التخزين | `civilization/062-domain` | 6 | planned | لا |
| 63 | `063-domain` | الأجهزة المادية | `civilization/063-domain` | 6 | planned | لا |
| 64 | `064-domain` | السحابة | `civilization/064-domain` | 6 | planned | لا |
| 65 | `065-domain` | الأمن السيبراني | `civilization/065-domain` | 6 | planned | لا |
| 66 | `066-domain` | البيانات | `civilization/066-domain` | 6 | planned | لا |
| 67 | `067-domain` | المراقبة | `civilization/067-domain` | 6 | planned | لا |
| 68 | `068-domain` | الاستقلالية | `civilization/068-domain` | 6 | planned | لا |
| 69 | `069-domain` | توزيع الموارد | `civilization/069-domain` | 6 | planned | لا |
| 70 | `070-domain` | الاقتصاد | `civilization/070-domain` | 6 | planned | لا |
| 71 | `071-domain` | الخزانة | `civilization/071-domain` | 6 | planned | لا |
| 72 | `072-domain` | البنك المركزي الرقمي | `civilization/072-domain` | 6 | planned | لا |
| 73 | `073-domain` | التجارة | `civilization/073-domain` | 6 | planned | لا |
| 74 | `074-domain` | الاستثمار | `civilization/074-domain` | 6 | planned | لا |
| 75 | `075-domain` | الشركات الحكومية | `civilization/075-domain` | 6 | planned | لا |
| 76 | `076-domain` | الشركات التجارية | `civilization/076-domain` | 6 | planned | لا |
| 77 | `077-domain` | المصانع | `civilization/077-domain` | 6 | planned | لا |
| 78 | `078-domain` | المستشفيات | `civilization/078-domain` | 6 | planned | لا |
| 79 | `079-domain` | المختبرات | `civilization/079-domain` | 6 | planned | لا |
| 80 | `080-domain` | الزراعة | `civilization/080-domain` | 6 | planned | لا |
| 81 | `081-domain` | الطاقة الإنتاجية | `civilization/081-domain` | 6 | planned | لا |
| 82 | `082-domain` | النقل | `civilization/082-domain` | 6 | planned | لا |
| 83 | `083-domain` | الاتصالات العامة | `civilization/083-domain` | 6 | planned | لا |
| 84 | `084-domain` | التعليم العام | `civilization/084-domain` | 6 | planned | لا |
| 85 | `085-domain` | الصحة الوكيلة | `civilization/085-domain` | 6 | planned | لا |
| 86 | `086-domain` | الصحة البشرية | `civilization/086-domain` | 6 | planned | لا |
| 87 | `087-domain` | العمل | `civilization/087-domain` | 6 | planned | لا |
| 88 | `088-domain` | التقاعد والإيقاف | `civilization/088-domain` | 6 | planned | لا |
| 89 | `089-domain` | الثقافة | `civilization/089-domain` | 6 | planned | لا |
| 90 | `090-domain` | الإعلام | `civilization/090-domain` | 6 | planned | لا |
| 91 | `091-domain` | البيئة | `civilization/091-domain` | 6 | planned | لا |
| 92 | `092-domain` | العلوم المستقبلية | `civilization/092-domain` | 6 | planned | لا |
| 93 | `093-domain` | الفضاء | `civilization/093-domain` | 6 | planned | لا |
| 94 | `094-domain` | المحيطات | `civilization/094-domain` | 6 | planned | لا |
| 95 | `095-domain` | المجتمع الوكيلي | `civilization/095-domain` | 6 | planned | لا |
| 96 | `096-domain` | الأخلاق | `civilization/096-domain` | 6 | planned | لا |
| 97 | `097-domain` | الشفافية | `civilization/097-domain` | 6 | planned | لا |
| 98 | `098-domain` | التدقيق | `civilization/098-domain` | 6 | planned | لا |
| 99 | `099-domain` | إدارة الإصدارات | `civilization/099-domain` | 6 | planned | لا |
| 100 | `100-domain` | التوافق | `civilization/100-domain` | 6 | planned | لا |
| 101 | `101-domain` | الاختبارات | `civilization/101-domain` | 6 | planned | لا |
| 102 | `102-domain` | الإطلاق | `civilization/102-domain` | 6 | planned | لا |
| 103 | `103-domain` | اكتمال الدولة | `civilization/103-domain` | 6 | planned | لا |
| 104 | `104-domain` | علوم المستقبل | `civilization/104-domain` | 6 | planned | لا |
| 105 | `105-domain` | المحاكاة الكونية | `civilization/105-domain` | 6 | planned | لا |
| 106 | `106-domain` | استعمار الفضاء | `civilization/106-domain` | 6 | planned | لا |
| 107 | `107-domain` | الهندسة الكوكبية | `civilization/107-domain` | 6 | planned | لا |
| 108 | `108-domain` | الطاقة الاندماجية | `civilization/108-domain` | 6 | planned | لا |
| 109 | `109-domain` | الخلود الرقمي | `civilization/109-domain` | 6 | planned | لا |
| 110 | `110-domain` | الوعي الاصطناعي | `civilization/110-domain` | 6 | planned | لا |
| 111 | `111-domain` | التواصل بين الأنواع | `civilization/111-domain` | 6 | planned | لا |
| 112 | `112-domain` | البيولوجيا الاصطناعية | `civilization/112-domain` | 6 | planned | لا |
| 113 | `113-domain` | الهندسة الوراثية | `civilization/113-domain` | 6 | planned | لا |
| 114 | `114-domain` | النانو | `civilization/114-domain` | 6 | planned | لا |
| 115 | `115-domain` | الحوسبة الكمية | `civilization/115-domain` | 6 | planned | لا |
| 116 | `116-domain` | الأنظمة الذاتية | `civilization/116-domain` | 6 | planned | لا |
| 117 | `117-domain` | المدن الذكية | `civilization/117-domain` | 6 | planned | لا |
| 118 | `118-domain` | المجتمعات الافتراضية | `civilization/118-domain` | 6 | planned | لا |
| 119 | `119-domain` | مرآة الحضارة | `civilization/119-domain` | 6 | planned | لا |
| 120 | `120-domain` | الرؤية والتفويض | `civilization/120-domain` | 6 | planned | نعم |
| 121 | `121-domain` | تثبيت النطاق | `civilization/121-domain` | 6 | planned | نعم |
| 122 | `122-domain` | سجل المخاطر | `civilization/122-domain` | 6 | planned | نعم |
| 123 | `123-domain` | معايير النجاح | `civilization/123-domain` | 6 | planned | نعم |
| 124 | `124-domain` | تهيئة المستودع | `civilization/124-domain` | 6 | planned | نعم |
| 125 | `125-domain` | سياسة الإصدارات | `civilization/125-domain` | 6 | planned | نعم |

## الأقاليم والولايات

| الإقليم | الاسم | عدد الولايات | عدد البلديات |
| --- | --- | --- | --- |
| `R001` | الإقليم الفدرالي 001 | 8 | 96 |
| `R002` | الإقليم الفدرالي 002 | 8 | 96 |
| `R003` | الإقليم الفدرالي 003 | 8 | 96 |
| `R004` | الإقليم الفدرالي 004 | 8 | 96 |
| `R005` | الإقليم الفدرالي 005 | 8 | 96 |
| `R006` | الإقليم الفدرالي 006 | 8 | 96 |
| `R007` | الإقليم الفدرالي 007 | 8 | 96 |
| `R008` | الإقليم الفدرالي 008 | 8 | 96 |
| `R009` | الإقليم الفدرالي 009 | 8 | 96 |
| `R010` | الإقليم الفدرالي 010 | 8 | 96 |
| `R011` | الإقليم الفدرالي 011 | 8 | 96 |
| `R012` | الإقليم الفدرالي 012 | 8 | 96 |
| `R013` | الإقليم الفدرالي 013 | 8 | 96 |
| `R014` | الإقليم الفدرالي 014 | 8 | 96 |
| `R015` | الإقليم الفدرالي 015 | 8 | 96 |
| `R016` | الإقليم الفدرالي 016 | 8 | 96 |
