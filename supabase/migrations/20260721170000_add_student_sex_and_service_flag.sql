-- (1) Biological sex on trainingpeaks_students (next to telegram_formality) for Russian
--     grammatical-gender agreement in generated workout feedback. Mirrors
--     nutrition_student_profiles.sex ('female'|'male'); the feedback prompt reuses the
--     gender-agreement rule already in narrative-guardrails.ts. Values verified by Igor
--     via the student NAME (chat messages are NOT authoritative -- see attribution audit).
-- (2) is_service_account: test/service accounts that are NOT real students. Excluded from
--     feedback generation, weekly reports and digests. Consuming code must filter
--     is_service_account = false. Igor Potseluev is Igor's own test account.
-- FILE ONLY -- apply manually, not auto-run.
alter table public.trainingpeaks_students
  add column if not exists sex text check (sex is null or sex in ('female', 'male'));

alter table public.trainingpeaks_students
  add column if not exists is_service_account boolean not null default false;

update public.trainingpeaks_students set sex = 'female' where id in (
  '0064c435-32ff-4084-a91e-58381fb1aeb4',  -- Naida Volkova
  '02c0c9d4-2528-4d6e-abc1-4b19ba8680b0',  -- Larionova
  '06e0f691-b461-4c6b-9577-7e1d43102d93',  -- Natalia Erikenova
  '07445702-4cce-4c09-b801-b9376e83d668',  -- Kira Antsyferova
  '0c0298d1-defb-4a16-b8ac-798e642c055e',  -- Vera Vyrvich
  '0d05c6c9-7d75-4757-9e58-0abd8e081cea',  -- Anastasia Utenkova
  '0df6a439-93cc-40c9-a5a3-cfe4f337ea8f',  -- Olga Panina
  '0e407530-ce05-48d1-b6cf-57631e89a322',  -- Polina Tsalman
  '0ee97744-43c0-4bb0-89a0-5a93def16b69',  -- Olga Slastnaia
  '13b86a47-5727-4b86-8260-cf867f497b30',  -- Nastya Bunyakina
  '153a9238-8622-4d29-bd12-959aef45a13d',  -- olgakogtina
  '158d1936-92e1-4be4-9710-26a8bef7bb66',  -- Khadizhat Murtazalieva
  '18daeeb2-07ba-4eae-bb3a-dbed801d0799',  -- Martynenko Marija
  '18faf06a-404f-452e-bf58-9c926d381e37',  -- Mariyet Kalakutok
  '1af7d1cb-e792-4ff8-a249-15b98786d163',  -- Marina Nikolaeva
  '1fa853da-756c-4ff2-9cf7-c24ecaa2340e',  -- Olesya Voronina
  '234d0fcb-8014-4019-998a-21270bffe169',  -- Yulia Grigoreva
  '25f54c3c-b460-43b1-af99-0e6e85c62203',  -- Varya O
  '2a10d457-8fd8-4ef9-be18-8c741a5023ae',  -- Tatiana Buchkina
  '3a15df76-aa81-41d6-a921-8ef94cef319c',  -- Anna Denisova
  '3b57509b-be55-417d-9e28-c795e69a96e8',  -- Anastasiya Grushevskaya
  '3d89884a-6b3b-4894-9802-1cb6a2136e6d',  -- Anna Frantsuzova
  '3ec3ae89-25b6-4012-b0b9-3de0d0d7a115',  -- Yulia Rasnitsova
  '404d7528-d424-4e2a-a890-530cef375c8c',  -- Anna Kukushkina
  '49498f07-064c-4a5e-a553-f68642eaaa71',  -- Rizatdinova Elvira
  '4ab4be4d-f05b-4d4e-be83-1588bbacb800',  -- Svetlana Nesterova
  '4af2d7ef-5f4f-4187-879f-174f0e5458a9',  -- Tatyana Volkova
  '4cd8f9bb-9438-4664-995b-fed91c032f76',  -- Nastya Holodnaya
  '4e76a1dc-22fe-4f2b-94c9-16f87fa6d6a9',  -- Maria Zueva
  '4e83c525-1c27-4d32-8b04-e08fcd739c28',  -- Tatiana Trofimova
  '5000888b-9830-461f-983d-f9ad478ac523',  -- Anna Lobodina
  '5010c8f8-f425-498d-81d7-c40d0d62c97b',  -- Gladkikh Ekaterina
  '50b415c6-d5e0-4feb-9662-c81d01069e9c',  -- Viktoriya Kononova
  '515ce410-e186-450a-9b2d-d906ee9b8843',  -- Maria Turkina
  '524dbedd-8ab3-455e-aba3-b6c20c736a43',  -- Anastasia Abramova
  '53428a4e-3fdf-4862-8e69-2bcdd54b9dc4',  -- Viktoria Sergeeva
  '58360036-8ddd-43ba-bbbb-bd255a47baac',  -- Koroleva Anna
  '59898205-3252-4c6e-91d5-740a79261312',  -- Yulia Kuznetsova
  '5d85b152-a036-4b4b-a73a-832289930caa',  -- Aleksandra Kasianenko
  '5df7db0b-0f5f-40dd-808f-8311c3eedfd7',  -- Darya Khmelkova
  '5f5d400d-6024-4ba4-b6ae-6bbe3a679862',  -- Anna Kruglova
  '63a9be52-4158-4e5d-aaa2-00e501644472',  -- Kristina Pamparaite
  '647719e2-6f92-461b-9327-da426d2c4ea6',  -- Liliya Zalogina
  '6c7062ff-db17-4daf-b938-89e53edd06b6',  -- Ksenia Vlasova
  '763f98a3-c815-41f2-a8fe-6bfd09f0e501',  -- Alena Grill
  '7809fed1-3329-41b4-9bfc-5aa014483962',  -- Aleksandra Tararova
  '7aacbe93-4fc6-48f9-80d6-9ee57f9dd9e7',  -- Irina Melnikova
  '8180a050-a883-42d7-ad13-4fb9da03c7ee',  -- Elena Yarulina
  '8383031a-2d7f-42bf-adc9-aa668aeabf7c',  -- Kudryavtseva Liliya
  '85a9d2d1-0b10-41de-bc73-f87f9fdc335c',  -- Alena Kovaldova
  '86296826-e9fe-4e0c-ab29-8231a1474adf',  -- Katerina Melnikova
  '86475e36-b236-4d32-8d30-336e5dfc2f96',  -- Leila Ermakova
  '8a090b0f-affd-4c90-9e25-66308478a86b',  -- Dolgor Takhanaeva
  '94ffca4b-a1c7-40d3-91d0-f698bdbba6f8',  -- Ekaterina Golovko
  '9882d879-c839-48ff-b74c-47384e5d98d8',  -- Elizaveta Kolodkina
  '98924047-5fc0-408f-9493-c584c8a837ed',  -- Tatyana Rishko
  '9d3e1c0f-935b-4dbf-820a-693362c842ea',  -- Nadezhda Ponomareva
  'a595327e-be91-4740-8028-1ec14ed0535a',  -- Eseniya Degtyareva
  'ab959228-cd98-4354-9007-ee2b1791e895',  -- Anna Plotnitskaya
  'ad95bdf9-eba8-45dc-9aba-26347e478dc7',  -- Sofia Vlasova
  'b042c097-ed36-4e48-b9f5-d28d5257876b',  -- Olga
  'b3d25f76-a0c7-4324-a02a-f580960bfd53',  -- Anastasia Il
  'b4095414-067e-4059-b712-7e249cd52aab',  -- Veronika Ashrapova
  'b5e7ad95-d70c-43c7-86da-ff0602385ad1',  -- Gudkova Ekaterina
  'bc66559d-a008-4fc2-939a-48222a73917d',  -- ELENA
  'bea7aad5-f1f6-4aaa-8145-6602a130b8d7',  -- Любовь Селезнева
  'bf8de7f5-7788-44eb-9df3-d292a775c349',  -- Darya Aliabyeva
  'c2ce62da-e5e4-4a1b-82ea-b80d62abe8fd',  -- Levina Ekaterina
  'c8df693f-e73c-4625-8d21-9c0e5bfbea12',  -- SKORODUMOVA Anastasia
  'c94acba4-3935-4c70-9194-f756b857d703',  -- Yana Peremyshlennikova
  'cc76db3c-eae8-42d1-a66e-7e4c8f176726',  -- Margarita Nekrasova
  'd5533447-1817-49d6-beea-53d76a34f995',  -- Elena Leonova
  'd64c29e4-99f3-488e-a0c9-7f11787ba80e',  -- Jelizaveta Stolova
  'e2392539-304d-47d2-b2a0-adb46ce3acaf',  -- Nadezhda Semeshina
  'e3012f0e-7c8f-4455-b823-fe59b636eeff',  -- Nadezhda Starostina
  'eb073a94-0198-4c10-bdeb-dc5be8d4903f',  -- Polyakova Anastasia
  'eb0c6417-e3c7-4412-aea3-6da5a482d6d6',  -- Tanya Zheleznikova
  'ee155195-4b0c-4327-93bd-b3c0c0e288ca',  -- Maria Panteleeva
  'f079b0db-a79e-4970-aced-3c3929283664',  -- Margarita
  'f43f9cc1-f922-4737-9016-77ca4ade6324',  -- Daria Postolaki
  'f8822175-9e43-442e-9065-9577c67d086e',  -- Elena Titskaia
  'f8b96028-4ea4-4cdf-86f4-d9ea89ef718e',  -- Nadya Hoffman
  'faa8ef04-c05e-4175-b308-61d8b7a21f16',  -- Yulia Krylova
  'fbaa6e6d-91ad-472c-b741-2ba02729e7b9',  -- Elena Vasileva
  'fc73717f-9571-46e2-b4c3-ff8a91e9f6cf',  -- Anna Kuzovkina
  'fe369bc9-5423-46ac-ad74-346ecaa2461f'   -- Anna Chernysheva
);

update public.trainingpeaks_students set sex = 'male' where id in (
  '050c2b3a-a21e-4581-afef-125d91d071c9',  -- Emil Hasanov
  '0816aae8-cfec-4c50-8547-12d84378b589',  -- Alexander Lavrentyev
  '0eaa6115-144f-4707-828d-f6fb88508e94',  -- Oleg Matrosov
  '23352ced-c82f-49d0-8b9e-93350b3c89c0',  -- Igor Karnaukh
  '2deba7bc-11ac-42eb-9901-d2037cb75b03',  -- Maxim Korostelev
  '33dcf076-539c-439f-8d12-bb0b508e604d',  -- grigori bereznoi
  '3c75c972-576e-40a8-bab2-f0e07a40453e',  -- Alex
  '45325e95-7d81-48d6-bc1a-7b0ea93d277e',  -- Danil Morozov
  '45ba4e6d-37a8-4ba0-9e56-824559b9ba96',  -- Aleksei Lobus
  '536adfd0-ad29-4fad-bb9f-0590b2a6fd57',  -- Levan
  '55fb25a2-c2c6-42a0-bb36-f434c542fab5',  -- Igor Klimovich
  '65952086-2f3d-4b21-9cd1-6b04e99aa0c0',  -- ILYA BOGDANOV
  '681bdb68-21d8-4a7a-849c-516c1fa57d75',  -- slava Taranec
  '6a380d8e-746f-4ea6-b7fa-2bd86eb1e045',  -- Maksim Severin
  '73e667e3-71af-448a-bcef-498a21bb35df',  -- Nazarov Dima
  '7512230d-3870-4eda-94e4-4542c65f7942',  -- Demian Diachenko
  '768ac3ec-0999-4c16-be93-a255235e8d6d',  -- Valentin Shavkun
  '852aa78d-bee6-47cb-b7fc-6a968d19b112',  -- Ravil Urazov
  '8b3b6fa2-65d2-4c3a-b516-c561157c8601',  -- Filip Krasavin
  '9fac2506-43bf-4fc4-a228-c91c2c9c200b',  -- Sergei Ivoshin
  'a156e797-4f85-467d-b5b0-87fdb3a8ecaf',  -- Larionov Stepan
  'ab1ec79d-fffd-4797-96c8-ce50c354aa59',  -- Alexander Ivanov
  'c0fdf186-f0d6-4e1e-a40d-e3d0bb179ec7',  -- sergey romanovskiy
  'c30d49a4-fcb6-449e-ab29-a8b24a3d6000',  -- Danila Shorokh
  'c4b5fef7-299b-4c2e-a2da-673e0f045b99',  -- Абрамов Александр
  'd0b88327-7c8c-4c4e-b53a-5111dc170c0f',  -- Aleksandr Bogachev
  'd205eef4-8f5e-410a-b6d9-cd07bd6bd3c8',  -- Stas
  'd271cdb8-ecff-4be4-b586-a877858fdb53',  -- Erik Yashin
  'd70f254b-fd46-4a56-a55b-9c38fee2e484',  -- Anton Malyk
  'f49d5241-a92c-4a9e-8a5e-0e094bdf5d76',  -- Oleg Tsulenkov
  'f5f2c862-326f-4dd9-a5da-f555816a225b',  -- Aleksandr Sorokin
  'f8073c46-a383-4aa8-b7e1-5ed2fdb9f9fb',  -- Alexander Pautov
  'fcb0f9ab-cae8-412e-8142-fcd87a89cc8a'   -- Stepan Trofimov
);

update public.trainingpeaks_students set is_service_account = true where id in (
  '7cb54839-7e3b-4726-8023-1f49bd004168'   -- Igor Potseluev
);
