-- Populate external_id for system exercises to enable image loading
-- Maps exercise names to slugs from https://github.com/yuhonas/free-exercise-db

-- Chest
UPDATE exercise_library SET external_id = 'Barbell_Bench_Press_-_Medium_Grip' WHERE name = 'Barbell Bench Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Incline_Dumbbell_Press' WHERE name = 'Incline Dumbbell Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Incline_Cable_Flye' WHERE name = 'Cable Fly' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Bench_Press' WHERE name = 'Dumbbell Bench Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Barbell_Incline_Bench_Press_-_Medium_Grip' WHERE name = 'Incline Barbell Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Decline_Barbell_Bench_Press' WHERE name = 'Decline Bench Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dips_-_Chest_Version' WHERE name = 'Chest Dip' AND is_system = true;
UPDATE exercise_library SET external_id = 'Pushups' WHERE name = 'Push-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Flyes' WHERE name = 'Dumbbell Fly' AND is_system = true;
UPDATE exercise_library SET external_id = 'Leverage_Chest_Press' WHERE name = 'Machine Chest Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Landmine_Linear_Jammer' WHERE name = 'Landmine Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Cable_Crossover' WHERE name = 'Cable Crossover' AND is_system = true;
UPDATE exercise_library SET external_id = 'Bent-Arm_Dumbbell_Pullover' WHERE name = 'Dumbbell Pullover' AND is_system = true;
UPDATE exercise_library SET external_id = 'Decline_Dumbbell_Bench_Press' WHERE name = 'Decline Dumbbell Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Push-Up_Wide' WHERE name = 'Wide Push-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Decline_Push-Up' WHERE name = 'Decline Push-up' AND is_system = true;

-- Back
UPDATE exercise_library SET external_id = 'Barbell_Deadlift' WHERE name = 'Deadlift' AND is_system = true;
UPDATE exercise_library SET external_id = 'Pullups' WHERE name = 'Pull-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Bent_Over_Barbell_Row' WHERE name = 'Barbell Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Full_Range-Of-Motion_Lat_Pulldown' WHERE name = 'Lat Pulldown' AND is_system = true;
UPDATE exercise_library SET external_id = 'Seated_Cable_Rows' WHERE name = 'Seated Cable Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'One-Arm_Dumbbell_Row' WHERE name = 'Dumbbell Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'T-Bar_Row_with_Handle' WHERE name = 'T-Bar Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Chin-Up' WHERE name = 'Chin-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Face_Pull' WHERE name = 'Face Pull' AND is_system = true;
UPDATE exercise_library SET external_id = 'Cable_Rope_Rear-Delt_Rows' WHERE name = 'Cable Face Pull' AND is_system = true;
UPDATE exercise_library SET external_id = 'Straight-Arm_Pulldown' WHERE name = 'Straight Arm Pulldown' AND is_system = true;
UPDATE exercise_library SET external_id = 'Rack_Pulls' WHERE name = 'Rack Pull' AND is_system = true;
UPDATE exercise_library SET external_id = 'Reverse_Grip_Bent-Over_Rows' WHERE name = 'Pendlay Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Leverage_High_Row' WHERE name = 'Machine Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Inverted_Row' WHERE name = 'Inverted Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Close-Grip_Front_Lat_Pulldown' WHERE name = 'Chin-up Close Grip' AND is_system = true;
UPDATE exercise_library SET external_id = 'Alternating_Renegade_Row' WHERE name = 'Renegade Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Hyperextensions_Back_Extensions' WHERE name = 'Superman' AND is_system = true;

-- Shoulders
UPDATE exercise_library SET external_id = 'Standing_Military_Press' WHERE name = 'Overhead Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Shoulder_Press' WHERE name = 'Dumbbell Shoulder Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Side_Lateral_Raise' WHERE name = 'Lateral Raise' AND is_system = true;
UPDATE exercise_library SET external_id = 'Arnold_Dumbbell_Press' WHERE name = 'Arnold Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Front_Dumbbell_Raise' WHERE name = 'Front Raise' AND is_system = true;
UPDATE exercise_library SET external_id = 'Reverse_Flyes' WHERE name = 'Reverse Fly' AND is_system = true;
UPDATE exercise_library SET external_id = 'Cable_Seated_Lateral_Raise' WHERE name = 'Cable Lateral Raise' AND is_system = true;
UPDATE exercise_library SET external_id = 'Reverse_Machine_Flyes' WHERE name = 'Rear Delt Fly Machine' AND is_system = true;
UPDATE exercise_library SET external_id = 'Upright_Barbell_Row' WHERE name = 'Upright Row' AND is_system = true;
UPDATE exercise_library SET external_id = 'Machine_Shoulder_Military_Press' WHERE name = 'Machine Shoulder Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Shrug' WHERE name = 'Dumbbell Shrug' AND is_system = true;
UPDATE exercise_library SET external_id = 'Push_Press' WHERE name = 'Push Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Clean_and_Press' WHERE name = 'Clean and Press' AND is_system = true;

-- Biceps
UPDATE exercise_library SET external_id = 'Barbell_Curl' WHERE name = 'Barbell Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Bicep_Curl' WHERE name = 'Dumbbell Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Hammer_Curls' WHERE name = 'Hammer Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Preacher_Curl' WHERE name = 'Preacher Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Incline_Dumbbell_Curl' WHERE name = 'Incline Dumbbell Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Standing_Biceps_Cable_Curl' WHERE name = 'Cable Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Concentration_Curls' WHERE name = 'Concentration Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Zottman_Curl' WHERE name = 'Dumbbell Zottman Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'EZ-Bar_Curl' WHERE name = 'Wrist Curl' AND is_system = true;

-- Triceps
UPDATE exercise_library SET external_id = 'Triceps_Pushdown' WHERE name = 'Tricep Pushdown' AND is_system = true;
UPDATE exercise_library SET external_id = 'EZ-Bar_Skullcrusher' WHERE name = 'Skull Crusher' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dips_-_Triceps_Version' WHERE name = 'Tricep Dip' AND is_system = true;
UPDATE exercise_library SET external_id = 'Cable_Rope_Overhead_Triceps_Extension' WHERE name = 'Overhead Cable Extension' AND is_system = true;
UPDATE exercise_library SET external_id = 'Close-Grip_Barbell_Bench_Press' WHERE name = 'Close-Grip Bench Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Standing_Dumbbell_Triceps_Extension' WHERE name = 'Overhead Tricep Extension' AND is_system = true;
UPDATE exercise_library SET external_id = 'Tricep_Dumbbell_Kickback' WHERE name = 'Tricep Kickback' AND is_system = true;
UPDATE exercise_library SET external_id = 'Bench_Dips' WHERE name = 'Bench Dip' AND is_system = true;
UPDATE exercise_library SET external_id = 'Lying_Dumbbell_Tricep_Extension' WHERE name = 'Diamond Push-up' AND is_system = true;

-- Legs
UPDATE exercise_library SET external_id = 'Barbell_Squat' WHERE name = 'Barbell Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Leg_Press' WHERE name = 'Leg Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Romanian_Deadlift' WHERE name = 'Romanian Deadlift' AND is_system = true;
UPDATE exercise_library SET external_id = 'Leg_Extensions' WHERE name = 'Leg Extension' AND is_system = true;
UPDATE exercise_library SET external_id = 'Lying_Leg_Curls' WHERE name = 'Leg Curl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Split_Squats' WHERE name = 'Bulgarian Split Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Barbell_Hip_Thrust' WHERE name = 'Hip Thrust' AND is_system = true;
UPDATE exercise_library SET external_id = 'Front_Barbell_Squat' WHERE name = 'Front Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Goblet_Squat' WHERE name = 'Goblet Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Hack_Squat' WHERE name = 'Hack Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Lunges' WHERE name = 'Walking Lunge' AND is_system = true;
UPDATE exercise_library SET external_id = 'Stiff-Legged_Dumbbell_Deadlift' WHERE name = 'Dumbbell Romanian Deadlift' AND is_system = true;
UPDATE exercise_library SET external_id = 'Standing_Calf_Raises' WHERE name = 'Standing Calf Raise' AND is_system = true;
UPDATE exercise_library SET external_id = 'Bodyweight_Squat' WHERE name = 'Bodyweight Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Step_Ups' WHERE name = 'Dumbbell Step-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dumbbell_Rear_Lunge' WHERE name = 'Reverse Lunge' AND is_system = true;
UPDATE exercise_library SET external_id = 'Kettlebell_Pistol_Squat' WHERE name = 'Pistol Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Sumo_Deadlift' WHERE name = 'Sumo Deadlift' AND is_system = true;

-- Core
UPDATE exercise_library SET external_id = 'Plank' WHERE name = 'Plank' AND is_system = true;
UPDATE exercise_library SET external_id = 'Ab_Roller' WHERE name = 'Ab Wheel Rollout' AND is_system = true;
UPDATE exercise_library SET external_id = 'Hanging_Leg_Raise' WHERE name = 'Hanging Leg Raise' AND is_system = true;
UPDATE exercise_library SET external_id = 'Cable_Crunch' WHERE name = 'Cable Crunch' AND is_system = true;
UPDATE exercise_library SET external_id = 'Russian_Twist' WHERE name = 'Russian Twist' AND is_system = true;
UPDATE exercise_library SET external_id = 'Dead_Bug' WHERE name = 'Dead Bug' AND is_system = true;
UPDATE exercise_library SET external_id = 'Mountain_Climbers' WHERE name = 'Mountain Climber' AND is_system = true;
UPDATE exercise_library SET external_id = 'Side_Bridge' WHERE name = 'Side Plank' AND is_system = true;
UPDATE exercise_library SET external_id = 'Decline_Crunch' WHERE name = 'Decline Sit-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Weighted_Crunches' WHERE name = 'Weighted Sit-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Pallof_Press' WHERE name = 'Pallof Press' AND is_system = true;
UPDATE exercise_library SET external_id = 'Cross-Body_Crunch' WHERE name = 'Bicycle Crunch' AND is_system = true;
UPDATE exercise_library SET external_id = 'Jackknife_Sit-Up' WHERE name = 'V-up' AND is_system = true;

-- Full Body / Compound
UPDATE exercise_library SET external_id = 'Battling_Ropes' WHERE name = 'Battle Ropes' AND is_system = true;
UPDATE exercise_library SET external_id = 'One-Arm_Kettlebell_Swings' WHERE name = 'Kettlebell Swing' AND is_system = true;
UPDATE exercise_library SET external_id = 'Kettlebell_Turkish_Get-Up_Squat_style' WHERE name = 'Turkish Get-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Farmers_Walk' WHERE name = 'Farmer''s Walk' AND is_system = true;
UPDATE exercise_library SET external_id = 'Barbell_Glute_Bridge' WHERE name = 'Glute Bridge' AND is_system = true;
UPDATE exercise_library SET external_id = 'Box_Jump_Multiple_Response' WHERE name = 'Box Jump' AND is_system = true;
UPDATE exercise_library SET external_id = 'Freehand_Jump_Squat' WHERE name = 'Jump Squat' AND is_system = true;
UPDATE exercise_library SET external_id = 'Sled_Push' WHERE name = 'Sled Push' AND is_system = true;
UPDATE exercise_library SET external_id = 'Rowing_Stationary' WHERE name = 'Rowing Machine' AND is_system = true;
UPDATE exercise_library SET external_id = 'Standing_Cable_Wood_Chop' WHERE name = 'Dumbbell Woodchop' AND is_system = true;
UPDATE exercise_library SET external_id = 'Handstand_Push-Ups' WHERE name = 'Handstand Push-up' AND is_system = true;
UPDATE exercise_library SET external_id = 'Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench' WHERE name = 'Dumbbell Reverse Fly' AND is_system = true;
UPDATE exercise_library SET external_id = 'Bear_Crawl_Sled_Drags' WHERE name = 'Bear Crawl' AND is_system = true;
UPDATE exercise_library SET external_id = 'Lateral_Raise_-_With_Bands' WHERE name = 'Lu Raise' AND is_system = true;

-- Note: The following exercises have no matching slug in free-exercise-db and will not have images:
-- Archer Push-up, Bodyweight Y Raise, Burpee, Jumping Jack, Pec Deck Machine, Pike Push-up, Wall Sit, Wall Walk
