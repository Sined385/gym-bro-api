-- ============================================================
-- Seed mock community users, onboarding data, sessions & posts
-- ============================================================

-- 1. Create mock auth users (Supabase auth.users)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, raw_app_meta_data, raw_user_meta_data)
VALUES
    ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'alex.johnson@example.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Alex Johnson"}'::jsonb),

    ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sarah.chen@example.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Sarah Chen"}'::jsonb),

    ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'mike.torres@example.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Mike Torres"}'::jsonb),

    ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'emma.wilson@example.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Emma Wilson"}'::jsonb),

    ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'james.park@example.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"James Park"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 2. Create identities for auth users (required by Supabase)
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'alex.johnson@example.com',
     '{"sub":"a1111111-1111-1111-1111-111111111111","email":"alex.johnson@example.com"}'::jsonb, 'email', NOW(), NOW(), NOW()),
    ('b2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'sarah.chen@example.com',
     '{"sub":"b2222222-2222-2222-2222-222222222222","email":"sarah.chen@example.com"}'::jsonb, 'email', NOW(), NOW(), NOW()),
    ('c3333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333', 'mike.torres@example.com',
     '{"sub":"c3333333-3333-3333-3333-333333333333","email":"mike.torres@example.com"}'::jsonb, 'email', NOW(), NOW(), NOW()),
    ('d4444444-4444-4444-4444-444444444444', 'd4444444-4444-4444-4444-444444444444', 'emma.wilson@example.com',
     '{"sub":"d4444444-4444-4444-4444-444444444444","email":"emma.wilson@example.com"}'::jsonb, 'email', NOW(), NOW(), NOW()),
    ('e5555555-5555-5555-5555-555555555555', 'e5555555-5555-5555-5555-555555555555', 'james.park@example.com',
     '{"sub":"e5555555-5555-5555-5555-555555555555","email":"james.park@example.com"}'::jsonb, 'email', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. Public users table (created by Prisma normally, but seed it here)
CREATE TABLE IF NOT EXISTS public."User" (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public."User" (id, email, full_name, avatar_url, created_at)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'alex.johnson@example.com', 'Alex Johnson', NULL, NOW()),
    ('b2222222-2222-2222-2222-222222222222', 'sarah.chen@example.com', 'Sarah Chen', NULL, NOW()),
    ('c3333333-3333-3333-3333-333333333333', 'mike.torres@example.com', 'Mike Torres', NULL, NOW()),
    ('d4444444-4444-4444-4444-444444444444', 'emma.wilson@example.com', 'Emma Wilson', NULL, NOW()),
    ('e5555555-5555-5555-5555-555555555555', 'james.park@example.com', 'James Park', NULL, NOW())
ON CONFLICT (id) DO NOTHING;

-- 4. Onboarding data (profiles)
INSERT INTO public.onboarding_data (id, user_id, primary_goal, primary_sport, experience_level, training_frequency, workout_duration, available_equipment, body_weight_kg, injuries, completed_at, created_at, updated_at)
VALUES
    (gen_random_uuid(), 'a1111111-1111-1111-1111-111111111111', 'build_muscle', 'Weightlifting', 'advanced', 5, 60, 'full_gym', 84, '[]'::jsonb, NOW(), NOW(), NOW()),
    (gen_random_uuid(), 'b2222222-2222-2222-2222-222222222222', 'lose_fat', 'CrossFit', 'intermediate', 4, 45, 'full_gym', 62, '[]'::jsonb, NOW(), NOW(), NOW()),
    (gen_random_uuid(), 'c3333333-3333-3333-3333-333333333333', 'get_stronger', 'Powerlifting', 'advanced', 6, 90, 'full_gym', 95, '[]'::jsonb, NOW(), NOW(), NOW()),
    (gen_random_uuid(), 'd4444444-4444-4444-4444-444444444444', 'stay_healthy', 'Yoga', 'beginner', 3, 30, 'bodyweight', 58, '[]'::jsonb, NOW(), NOW(), NOW()),
    (gen_random_uuid(), 'e5555555-5555-5555-5555-555555555555', 'improve_endurance', 'Running', 'intermediate', 5, 60, 'home_gym', 76, '["Knee pain"]'::jsonb, NOW(), NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

-- 5. Workout sessions (completed, for attachment & stats)
INSERT INTO public.workout_sessions (id, user_id, title, type, status, started_at, completed_at, duration_minutes, ai_generated, created_at, updated_at)
VALUES
    ('f1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Upper Body Power', 'strength', 'completed', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 55, true, NOW() - INTERVAL '2 hours', NOW()),
    ('f2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'HIIT Cardio Blast', 'cardio', 'completed', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours 15 minutes', 45, false, NOW() - INTERVAL '5 hours', NOW()),
    ('f3333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333', 'Deadlift & Back Day', 'strength', 'completed', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '80 minutes', 80, true, NOW() - INTERVAL '1 day', NOW()),
    ('f4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111', 'Leg Day Destroyer', 'strength', 'completed', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '65 minutes', 65, true, NOW() - INTERVAL '3 days', NOW()),
    ('f5555555-5555-5555-5555-555555555555', 'e5555555-5555-5555-5555-555555555555', 'Morning Run + Core', 'cardio', 'completed', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours', 50, false, NOW() - INTERVAL '6 hours', NOW())
ON CONFLICT (id) DO NOTHING;

-- 6. Session exercises (for exercise count on workout attachments)
INSERT INTO public.session_exercises (id, session_id, name, step_number, sets_display, muscle_group, equipment, created_at)
VALUES
    (gen_random_uuid(), 'f1111111-1111-1111-1111-111111111111', 'Barbell Bench Press', 1, '4 × 8', 'Chest', 'Barbell', NOW()),
    (gen_random_uuid(), 'f1111111-1111-1111-1111-111111111111', 'Incline Dumbbell Press', 2, '3 × 10', 'Chest', 'Dumbbells', NOW()),
    (gen_random_uuid(), 'f1111111-1111-1111-1111-111111111111', 'Overhead Press', 3, '3 × 8', 'Shoulders', 'Barbell', NOW()),
    (gen_random_uuid(), 'f1111111-1111-1111-1111-111111111111', 'Lateral Raise', 4, '3 × 12', 'Shoulders', 'Dumbbells', NOW()),
    (gen_random_uuid(), 'f1111111-1111-1111-1111-111111111111', 'Tricep Extension', 5, '3 × 12', 'Arms', 'Cable', NOW()),
    (gen_random_uuid(), 'f1111111-1111-1111-1111-111111111111', 'Pull-ups', 6, '3 × 10', 'Back', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f2222222-2222-2222-2222-222222222222', 'Burpees', 1, '4 × 15', 'Core', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f2222222-2222-2222-2222-222222222222', 'Box Jumps', 2, '4 × 12', 'Legs', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f2222222-2222-2222-2222-222222222222', 'Kettlebell Swings', 3, '4 × 15', 'Back', 'Dumbbells', NOW()),
    (gen_random_uuid(), 'f2222222-2222-2222-2222-222222222222', 'Mountain Climbers', 4, '3 × 30s', 'Core', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f3333333-3333-3333-3333-333333333333', 'Barbell Deadlift', 1, '5 × 5', 'Back', 'Barbell', NOW()),
    (gen_random_uuid(), 'f3333333-3333-3333-3333-333333333333', 'Barbell Row', 2, '4 × 8', 'Back', 'Barbell', NOW()),
    (gen_random_uuid(), 'f3333333-3333-3333-3333-333333333333', 'Pull-ups', 3, '4 × 10', 'Back', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f3333333-3333-3333-3333-333333333333', 'Face Pulls', 4, '3 × 15', 'Shoulders', 'Cable', NOW()),
    (gen_random_uuid(), 'f3333333-3333-3333-3333-333333333333', 'Bicep Curl', 5, '3 × 12', 'Arms', 'Dumbbells', NOW()),
    (gen_random_uuid(), 'f4444444-4444-4444-4444-444444444444', 'Barbell Squat', 1, '4 × 8', 'Legs', 'Barbell', NOW()),
    (gen_random_uuid(), 'f4444444-4444-4444-4444-444444444444', 'Romanian Deadlift', 2, '3 × 10', 'Legs', 'Barbell', NOW()),
    (gen_random_uuid(), 'f4444444-4444-4444-4444-444444444444', 'Leg Press', 3, '3 × 12', 'Legs', 'Machine', NOW()),
    (gen_random_uuid(), 'f4444444-4444-4444-4444-444444444444', 'Leg Curl', 4, '3 × 12', 'Legs', 'Machine', NOW()),
    (gen_random_uuid(), 'f5555555-5555-5555-5555-555555555555', 'Plank', 1, '3 × 60s', 'Core', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f5555555-5555-5555-5555-555555555555', 'Russian Twist', 2, '3 × 20', 'Core', 'Bodyweight', NOW()),
    (gen_random_uuid(), 'f5555555-5555-5555-5555-555555555555', 'Bicycle Crunches', 3, '3 × 20', 'Core', 'Bodyweight', NOW())
ON CONFLICT (id) DO NOTHING;

-- 7. Community posts
INSERT INTO public.posts (id, user_id, content, visibility, photo_url, workout_session_id, created_at, updated_at)
VALUES
    -- Alex — recent with workout attachment + photo
    ('01111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
     'Just hit a new PR on bench press! 100 kg for 3 reps. Six months of grinding finally paying off. Feeling unstoppable today!',
     'global',
     'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
     'f1111111-1111-1111-1111-111111111111',
     NOW() - INTERVAL '1 hour', NOW()),

    -- Sarah — recent with photo
    ('02222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222',
     'Morning HIIT session done before sunrise. There is something magical about training when the rest of the world is still sleeping. Who else is part of the 5 AM club?',
     'global',
     'https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=800&q=80',
     'f2222222-2222-2222-2222-222222222222',
     NOW() - INTERVAL '4 hours', NOW()),

    -- Mike — yesterday with photo
    ('03333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333',
     'Back day never disappoints. Pulled 200 kg on deadlift today — a 10 kg jump from last month. Slow and steady wins the race. Keep showing up.',
     'global',
     'https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=800&q=80',
     'f3333333-3333-3333-3333-333333333333',
     NOW() - INTERVAL '1 day', NOW()),

    -- Emma — 2 days ago, no attachment, no photo
    ('04444444-4444-4444-4444-444444444444', 'd4444444-4444-4444-4444-444444444444',
     'Week 3 of my yoga journey and I can already touch my toes! It is the small wins that keep me going. Any fellow beginners out there?',
     'global', NULL, NULL,
     NOW() - INTERVAL '2 days', NOW()),

    -- Alex — 3 days ago with leg day attachment + photo
    ('05555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
     'Leg day is the best day. Squatted 140 kg for a clean set of 8. Walking will be optional tomorrow.',
     'global',
     'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=800&q=80',
     'f4444444-4444-4444-4444-444444444444',
     NOW() - INTERVAL '3 days', NOW()),

    -- James — friends-only post
    ('06666666-6666-6666-6666-666666666666', 'e5555555-5555-5555-5555-555555555555',
     'Dealing with some knee discomfort during runs. Taking it easy this week with low-impact cardio and core work. Recovery is part of the process.',
     'friends', NULL,
     'f5555555-5555-5555-5555-555555555555',
     NOW() - INTERVAL '5 hours', NOW()),

    -- Sarah — global, no attachment, older
    ('07777777-7777-7777-7777-777777777777', 'b2222222-2222-2222-2222-222222222222',
     'Rest day reminder: your muscles grow when you recover, not when you train. Take that rest day guilt-free!',
     'global', NULL, NULL,
     NOW() - INTERVAL '4 days', NOW()),

    -- Mike — friends-only, motivational, with photo
    ('08888888-8888-8888-8888-888888888888', 'c3333333-3333-3333-3333-333333333333',
     'Real talk: I almost skipped the gym today. But I showed up, did a lighter session, and still walked out feeling better than when I walked in. Discipline > motivation.',
     'friends',
     'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=800&q=80',
     NULL,
     NOW() - INTERVAL '2 days', NOW()),

    -- Emma — recent
    ('09999999-9999-9999-9999-999999999999', 'd4444444-4444-4444-4444-444444444444',
     'Found a great bodyweight routine that I can do at home in 30 minutes. No excuses! Consistency beats intensity every time.',
     'global', NULL, NULL,
     NOW() - INTERVAL '12 hours', NOW()),

    -- James — global
    ('a0aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e5555555-5555-5555-5555-555555555555',
     'New month, new goals. Targeting 50 km total running distance this month. Who wants to join the challenge?',
     'global', NULL, NULL,
     NOW() - INTERVAL '6 days', NOW())
ON CONFLICT (id) DO NOTHING;

-- 8. Post likes (some engagement)
INSERT INTO public.post_likes (id, post_id, user_id, created_at)
VALUES
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', NOW() - INTERVAL '50 minutes'),
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', NOW() - INTERVAL '45 minutes'),
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'd4444444-4444-4444-4444-444444444444', NOW() - INTERVAL '40 minutes'),
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'e5555555-5555-5555-5555-555555555555', NOW() - INTERVAL '30 minutes'),
    (gen_random_uuid(), '02222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', NOW() - INTERVAL '3 hours'),
    (gen_random_uuid(), '02222222-2222-2222-2222-222222222222', 'c3333333-3333-3333-3333-333333333333', NOW() - INTERVAL '2 hours'),
    (gen_random_uuid(), '02222222-2222-2222-2222-222222222222', 'e5555555-5555-5555-5555-555555555555', NOW() - INTERVAL '1 hour'),
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', NOW() - INTERVAL '20 hours'),
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'b2222222-2222-2222-2222-222222222222', NOW() - INTERVAL '18 hours'),
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'e5555555-5555-5555-5555-555555555555', NOW() - INTERVAL '16 hours'),
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'd4444444-4444-4444-4444-444444444444', NOW() - INTERVAL '12 hours'),
    (gen_random_uuid(), '04444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111', NOW() - INTERVAL '1 day 20 hours'),
    (gen_random_uuid(), '04444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222', NOW() - INTERVAL '1 day 18 hours'),
    (gen_random_uuid(), '05555555-5555-5555-5555-555555555555', 'c3333333-3333-3333-3333-333333333333', NOW() - INTERVAL '2 days 20 hours'),
    (gen_random_uuid(), '05555555-5555-5555-5555-555555555555', 'b2222222-2222-2222-2222-222222222222', NOW() - INTERVAL '2 days 18 hours'),
    (gen_random_uuid(), '05555555-5555-5555-5555-555555555555', 'd4444444-4444-4444-4444-444444444444', NOW() - INTERVAL '2 days 12 hours'),
    (gen_random_uuid(), '09999999-9999-9999-9999-999999999999', 'a1111111-1111-1111-1111-111111111111', NOW() - INTERVAL '10 hours'),
    (gen_random_uuid(), '09999999-9999-9999-9999-999999999999', 'c3333333-3333-3333-3333-333333333333', NOW() - INTERVAL '8 hours'),
    (gen_random_uuid(), 'a0aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b2222222-2222-2222-2222-222222222222', NOW() - INTERVAL '5 days'),
    (gen_random_uuid(), 'a0aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd4444444-4444-4444-4444-444444444444', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- 9. Post comments
INSERT INTO public.post_comments (id, post_id, user_id, content, created_at)
VALUES
    -- Comments on Alex's bench PR
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333',
     'Beast mode! 100 kg is no joke. Next stop: 120!', NOW() - INTERVAL '45 minutes'),
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
     'Incredible progress! What program are you running?', NOW() - INTERVAL '40 minutes'),
    (gen_random_uuid(), '01111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
     'Thanks! Running a 5/3/1 variation with extra volume on accessories.', NOW() - INTERVAL '35 minutes'),

    -- Comments on Sarah's HIIT post
    (gen_random_uuid(), '02222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111',
     '5 AM gang! Best time to train for sure.', NOW() - INTERVAL '3 hours'),
    (gen_random_uuid(), '02222222-2222-2222-2222-222222222222', 'e5555555-5555-5555-5555-555555555555',
     'I wish I had that discipline. My alarm and I are not on speaking terms.', NOW() - INTERVAL '2 hours'),

    -- Comments on Mike's deadlift post
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111',
     '200 kg! Absolute unit. What is your bodyweight right now?', NOW() - INTERVAL '20 hours'),
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333',
     'Sitting at 95 kg. Aiming for 2.5x bodyweight by end of year.', NOW() - INTERVAL '19 hours'),
    (gen_random_uuid(), '03333333-3333-3333-3333-333333333333', 'b2222222-2222-2222-2222-222222222222',
     'Goals! Keep us posted on the journey.', NOW() - INTERVAL '16 hours'),

    -- Comments on Emma's yoga post
    (gen_random_uuid(), '04444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222',
     'Love this! Flexibility is so underrated. Keep it up!', NOW() - INTERVAL '1 day 18 hours'),

    -- Comments on James's challenge post
    (gen_random_uuid(), 'a0aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b2222222-2222-2222-2222-222222222222',
     'Count me in! I have been wanting to up my cardio.', NOW() - INTERVAL '5 days'),
    (gen_random_uuid(), 'a0aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd4444444-4444-4444-4444-444444444444',
     'I will try for 30 km — baby steps!', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- 10. Friendships (some accepted, some pending)
INSERT INTO public.friendships (id, requester_id, addressee_id, status, created_at, updated_at)
VALUES
    -- Alex & Sarah are friends
    (gen_random_uuid(), 'a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'accepted', NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days'),
    -- Alex & Mike are friends
    (gen_random_uuid(), 'c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'accepted', NOW() - INTERVAL '20 days', NOW() - INTERVAL '19 days'),
    -- Sarah & Mike are friends
    (gen_random_uuid(), 'b2222222-2222-2222-2222-222222222222', 'c3333333-3333-3333-3333-333333333333', 'accepted', NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days'),
    -- James sent a pending request to Alex
    (gen_random_uuid(), 'e5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111', 'pending', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
    -- Emma & Sarah are friends
    (gen_random_uuid(), 'd4444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222', 'accepted', NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days')
ON CONFLICT DO NOTHING;
