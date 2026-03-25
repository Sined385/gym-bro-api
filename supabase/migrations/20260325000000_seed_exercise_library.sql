-- ============================================================
-- Expand exercise_library with full set of system exercises
-- Ensures enough exercises per equipment type for all onboarding
-- equipment options (full_gym, dumbbells_only, bodyweight, home_gym)
-- ============================================================

-- Detach session_exercises from old system library entries before deleting
UPDATE public.session_exercises SET library_exercise_id = NULL
WHERE library_exercise_id IN (SELECT id FROM public.exercise_library WHERE is_system = true);

-- Remove old seed data (only system exercises)
DELETE FROM public.exercise_library WHERE is_system = true;

-- Re-seed with comprehensive exercise library (118 exercises)
INSERT INTO public.exercise_library (user_id, name, muscle_group, equipment, is_system) VALUES
    -- Chest: BW:5, DB:5, BB:4, Cable:2, Machine:2 = 18
    (NULL, 'Barbell Bench Press',    'Chest', 'Barbell',    true),
    (NULL, 'Incline Dumbbell Press', 'Chest', 'Dumbbells',  true),
    (NULL, 'Cable Fly',             'Chest', 'Cable',      true),
    (NULL, 'Dumbbell Bench Press',  'Chest', 'Dumbbells',  true),
    (NULL, 'Incline Barbell Press', 'Chest', 'Barbell',    true),
    (NULL, 'Decline Bench Press',   'Chest', 'Barbell',    true),
    (NULL, 'Chest Dip',            'Chest', 'Bodyweight',  true),
    (NULL, 'Push-up',              'Chest', 'Bodyweight',  true),
    (NULL, 'Pec Deck Machine',     'Chest', 'Machine',    true),
    (NULL, 'Dumbbell Fly',         'Chest', 'Dumbbells',  true),
    (NULL, 'Machine Chest Press',  'Chest', 'Machine',    true),
    (NULL, 'Landmine Press',       'Chest', 'Barbell',    true),
    (NULL, 'Cable Crossover',      'Chest', 'Cable',      true),
    (NULL, 'Dumbbell Pullover',    'Chest', 'Dumbbells',  true),
    (NULL, 'Decline Dumbbell Press','Chest', 'Dumbbells',  true),
    (NULL, 'Wide Push-up',         'Chest', 'Bodyweight',  true),
    (NULL, 'Decline Push-up',      'Chest', 'Bodyweight',  true),
    (NULL, 'Archer Push-up',       'Chest', 'Bodyweight',  true),

    -- Back: BW:4, DB:4, BB:5, Cable:4, Machine:1 = 18
    (NULL, 'Pull-up',              'Back', 'Bodyweight',  true),
    (NULL, 'Barbell Row',          'Back', 'Barbell',    true),
    (NULL, 'Lat Pulldown',         'Back', 'Cable',      true),
    (NULL, 'Deadlift',             'Back', 'Barbell',    true),
    (NULL, 'Seated Cable Row',     'Back', 'Cable',      true),
    (NULL, 'Dumbbell Row',         'Back', 'Dumbbells',  true),
    (NULL, 'T-Bar Row',            'Back', 'Barbell',    true),
    (NULL, 'Chin-up',              'Back', 'Bodyweight',  true),
    (NULL, 'Face Pull',            'Back', 'Cable',      true),
    (NULL, 'Pendlay Row',          'Back', 'Barbell',    true),
    (NULL, 'Machine Row',          'Back', 'Machine',    true),
    (NULL, 'Straight Arm Pulldown','Back', 'Cable',      true),
    (NULL, 'Inverted Row',         'Back', 'Bodyweight',  true),
    (NULL, 'Rack Pull',            'Back', 'Barbell',    true),
    (NULL, 'Renegade Row',         'Back', 'Dumbbells',  true),
    (NULL, 'Dumbbell Shrug',       'Back', 'Dumbbells',  true),
    (NULL, 'Dumbbell Reverse Fly', 'Back', 'Dumbbells',  true),
    (NULL, 'Superman',             'Back', 'Bodyweight',  true),

    -- Legs: BW:6, DB:5, BB:5, Machine:4 = 20
    (NULL, 'Barbell Squat',        'Legs', 'Barbell',    true),
    (NULL, 'Romanian Deadlift',    'Legs', 'Barbell',    true),
    (NULL, 'Leg Press',            'Legs', 'Machine',    true),
    (NULL, 'Bulgarian Split Squat','Legs', 'Dumbbells',  true),
    (NULL, 'Leg Extension',        'Legs', 'Machine',    true),
    (NULL, 'Leg Curl',             'Legs', 'Machine',    true),
    (NULL, 'Walking Lunge',        'Legs', 'Dumbbells',  true),
    (NULL, 'Goblet Squat',         'Legs', 'Dumbbells',  true),
    (NULL, 'Hip Thrust',           'Legs', 'Barbell',    true),
    (NULL, 'Front Squat',          'Legs', 'Barbell',    true),
    (NULL, 'Hack Squat',           'Legs', 'Machine',    true),
    (NULL, 'Standing Calf Raise',  'Legs', 'Machine',    true),
    (NULL, 'Sumo Deadlift',        'Legs', 'Barbell',    true),
    (NULL, 'Dumbbell Step-up',     'Legs', 'Dumbbells',  true),
    (NULL, 'Glute Bridge',         'Legs', 'Bodyweight',  true),
    (NULL, 'Bodyweight Squat',     'Legs', 'Bodyweight',  true),
    (NULL, 'Pistol Squat',         'Legs', 'Bodyweight',  true),
    (NULL, 'Jump Squat',           'Legs', 'Bodyweight',  true),
    (NULL, 'Wall Sit',             'Legs', 'Bodyweight',  true),
    (NULL, 'Reverse Lunge',        'Legs', 'Bodyweight',  true),
    (NULL, 'Dumbbell Romanian Deadlift', 'Legs', 'Dumbbells', true),

    -- Shoulders: BW:4, DB:6, BB:3, Cable:2, Machine:2 = 17
    (NULL, 'Overhead Press',       'Shoulders', 'Barbell',    true),
    (NULL, 'Lateral Raise',        'Shoulders', 'Dumbbells',  true),
    (NULL, 'Dumbbell Shoulder Press','Shoulders','Dumbbells',  true),
    (NULL, 'Arnold Press',         'Shoulders', 'Dumbbells',  true),
    (NULL, 'Front Raise',          'Shoulders', 'Dumbbells',  true),
    (NULL, 'Reverse Fly',          'Shoulders', 'Dumbbells',  true),
    (NULL, 'Cable Lateral Raise',  'Shoulders', 'Cable',      true),
    (NULL, 'Upright Row',          'Shoulders', 'Barbell',    true),
    (NULL, 'Machine Shoulder Press','Shoulders', 'Machine',    true),
    (NULL, 'Rear Delt Fly Machine','Shoulders', 'Machine',    true),
    (NULL, 'Push Press',           'Shoulders', 'Barbell',    true),
    (NULL, 'Lu Raise',             'Shoulders', 'Dumbbells',  true),
    (NULL, 'Pike Push-up',         'Shoulders', 'Bodyweight',  true),
    (NULL, 'Handstand Push-up',    'Shoulders', 'Bodyweight',  true),
    (NULL, 'Wall Walk',            'Shoulders', 'Bodyweight',  true),
    (NULL, 'Bodyweight Y Raise',   'Shoulders', 'Bodyweight',  true),
    (NULL, 'Cable Face Pull',      'Shoulders', 'Cable',      true),

    -- Arms: BW:4, DB:6, BB:4, Cable:3 = 17
    (NULL, 'Barbell Curl',         'Arms', 'Barbell',    true),
    (NULL, 'Dumbbell Curl',        'Arms', 'Dumbbells',  true),
    (NULL, 'Tricep Pushdown',      'Arms', 'Cable',      true),
    (NULL, 'Hammer Curl',          'Arms', 'Dumbbells',  true),
    (NULL, 'Skull Crusher',        'Arms', 'Barbell',    true),
    (NULL, 'Preacher Curl',        'Arms', 'Barbell',    true),
    (NULL, 'Overhead Tricep Extension','Arms','Dumbbells',true),
    (NULL, 'Cable Curl',           'Arms', 'Cable',      true),
    (NULL, 'Tricep Dip',           'Arms', 'Bodyweight',  true),
    (NULL, 'Concentration Curl',   'Arms', 'Dumbbells',  true),
    (NULL, 'Close-Grip Bench Press','Arms', 'Barbell',    true),
    (NULL, 'Incline Dumbbell Curl','Arms', 'Dumbbells',  true),
    (NULL, 'Tricep Kickback',      'Arms', 'Dumbbells',  true),
    (NULL, 'Wrist Curl',           'Arms', 'Barbell',    true),
    (NULL, 'Diamond Push-up',      'Arms', 'Bodyweight',  true),
    (NULL, 'Bench Dip',            'Arms', 'Bodyweight',  true),
    (NULL, 'Chin-up Close Grip',   'Arms', 'Bodyweight',  true),
    (NULL, 'Overhead Cable Extension','Arms','Cable',     true),
    (NULL, 'Dumbbell Zottman Curl','Arms', 'Dumbbells',  true),

    -- Core: BW:10, Cable:2, DB:2 = 14
    (NULL, 'Plank',                'Core', 'Bodyweight',  true),
    (NULL, 'Hanging Leg Raise',    'Core', 'Bodyweight',  true),
    (NULL, 'Cable Crunch',         'Core', 'Cable',      true),
    (NULL, 'Ab Wheel Rollout',     'Core', 'Bodyweight',  true),
    (NULL, 'Russian Twist',        'Core', 'Bodyweight',  true),
    (NULL, 'Bicycle Crunch',       'Core', 'Bodyweight',  true),
    (NULL, 'Mountain Climber',     'Core', 'Bodyweight',  true),
    (NULL, 'Dead Bug',             'Core', 'Bodyweight',  true),
    (NULL, 'V-up',                 'Core', 'Bodyweight',  true),
    (NULL, 'Pallof Press',         'Core', 'Cable',      true),
    (NULL, 'Decline Sit-up',       'Core', 'Bodyweight',  true),
    (NULL, 'Side Plank',           'Core', 'Bodyweight',  true),
    (NULL, 'Dumbbell Woodchop',    'Core', 'Dumbbells',  true),
    (NULL, 'Weighted Sit-up',      'Core', 'Dumbbells',  true),

    -- Other: BW:5, DB:3, BB:1, Machine:2 = 11
    (NULL, 'Farmer''s Walk',       'Other', 'Dumbbells',  true),
    (NULL, 'Battle Ropes',         'Other', 'Bodyweight',  true),
    (NULL, 'Box Jump',             'Other', 'Bodyweight',  true),
    (NULL, 'Kettlebell Swing',     'Other', 'Dumbbells',  true),
    (NULL, 'Sled Push',            'Other', 'Machine',    true),
    (NULL, 'Turkish Get-up',       'Other', 'Dumbbells',  true),
    (NULL, 'Clean and Press',      'Other', 'Barbell',    true),
    (NULL, 'Burpee',               'Other', 'Bodyweight',  true),
    (NULL, 'Bear Crawl',           'Other', 'Bodyweight',  true),
    (NULL, 'Rowing Machine',       'Other', 'Machine',    true),
    (NULL, 'Jumping Jack',         'Other', 'Bodyweight',  true);
