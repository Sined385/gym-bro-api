import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('privacy')
  @Header('Content-Type', 'text/html')
  getPrivacy(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy — GymJam</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #F8F9FA; color: #1a1a2e; line-height: 1.7; -webkit-font-smoothing: antialiased; }
        header { background: #fff; border-bottom: 1px solid #eee; padding: 20px 0; }
        header .container { display: flex; align-items: center; justify-content: space-between; }
        .logo { font-size: 22px; font-weight: 800; color: #1a1a2e; text-decoration: none; letter-spacing: -0.5px; }
        .logo span { color: #E86A75; }
        nav a { font-size: 14px; font-weight: 600; color: #666; text-decoration: none; margin-left: 24px; transition: color 0.2s; }
        nav a:hover { color: #E86A75; }
        .container { max-width: 720px; margin: 0 auto; padding: 0 24px; }
        .hero { padding: 60px 0 40px; text-align: center; }
        .hero h1 { font-size: 36px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
        .hero p { color: #888; font-size: 15px; }
        .content { background: #fff; border-radius: 16px; padding: 48px; margin-bottom: 60px; border: 1px solid #eee; }
        .content h2 { font-size: 20px; font-weight: 700; margin-top: 36px; margin-bottom: 12px; color: #1a1a2e; }
        .content h2:first-child { margin-top: 0; }
        .content p { margin-bottom: 14px; color: #444; font-size: 15px; }
        .content ul { margin-bottom: 14px; padding-left: 24px; }
        .content li { margin-bottom: 8px; color: #444; font-size: 15px; }
        .content a { color: #E86A75; text-decoration: none; }
        .content a:hover { text-decoration: underline; }
        footer { text-align: center; padding: 32px 0; border-top: 1px solid #eee; color: #999; font-size: 13px; }
        @media (max-width: 600px) { .hero h1 { font-size: 28px; } .content { padding: 28px 20px; } nav a { margin-left: 16px; font-size: 13px; } }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <a href="https://gyymjaam.com" class="logo">Gym<span>Jam</span></a>
            <nav>
                <a href="/privacy">Privacy Policy</a>
            </nav>
        </div>
    </header>
    <div class="container">
        <div class="hero">
            <h1>Privacy Policy</h1>
            <p>Last updated: April 21, 2026</p>
        </div>
        <div class="content">
            <h2>1. Introduction</h2>
            <p>GymJam ("we", "our", or "us") operates the GymJam mobile application. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our app.</p>
            <p>By using GymJam, you agree to the collection and use of information in accordance with this policy.</p>

            <h2>2. Information We Collect</h2>
            <p><strong>Account Information:</strong> When you create an account, we collect your name, email address, and authentication credentials through Apple Sign-In or Google Sign-In. We do not store your password.</p>
            <p><strong>Profile Information:</strong> You may optionally provide a username, profile photo, and fitness-related details such as your body weight, experience level, primary goals, training preferences, equipment access, and injury information.</p>
            <p><strong>Workout Data:</strong> We collect data you enter during workouts, including exercises performed, sets, reps, weights, workout duration, and session feedback (effort level, energy, pain).</p>
            <p><strong>Health Data:</strong> With your explicit permission, we access Apple HealthKit to read and write workout data (calories burned, workout duration, activity type). We never sell HealthKit data or use it for advertising.</p>
            <p><strong>Community Content:</strong> Posts, comments, likes, and follow relationships you create within the app.</p>
            <p><strong>Usage Data:</strong> We collect analytics events such as screens viewed, features used, and session duration to improve the app experience.</p>
            <p><strong>Device Information:</strong> Device type, operating system version, and push notification tokens for delivering notifications.</p>

            <h2>3. How We Use Your Information</h2>
            <ul>
                <li>Provide and personalize the GymJam service, including AI-generated training plans and coach recommendations</li>
                <li>Track your workout progress and generate performance insights</li>
                <li>Enable social features (community feed, follows, comments)</li>
                <li>Send push notifications for relevant activity (new followers, likes, comments)</li>
                <li>Improve and optimize the app based on usage patterns</li>
                <li>Provide customer support</li>
            </ul>

            <h2>4. AI Features</h2>
            <p>GymJam uses OpenAI to power AI coach chat, training plan generation, and workout suggestions. Your fitness profile (goals, experience, equipment, injuries) and recent workout history may be sent to OpenAI to generate personalized responses. We do not send your name, email, or other personally identifying information to OpenAI.</p>

            <h2>5. Data Sharing</h2>
            <p>We do not sell, trade, or rent your personal information to third parties. We share data only with:</p>
            <ul>
                <li><strong>Supabase:</strong> Authentication and database hosting</li>
                <li><strong>OpenAI:</strong> AI-powered features (anonymized fitness data only)</li>
                <li><strong>Firebase:</strong> Push notifications and analytics</li>
                <li><strong>Apple:</strong> HealthKit data sync (stays on-device and in iCloud per Apple's policies)</li>
            </ul>

            <h2>6. Data Storage and Security</h2>
            <p>Your data is stored securely on Supabase-hosted PostgreSQL databases with encryption at rest and in transit (TLS). Authentication uses industry-standard JWT tokens validated via JWKS. We implement row-level security policies to ensure users can only access their own data.</p>

            <h2>7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
                <li><strong>Access</strong> your personal data through the app</li>
                <li><strong>Update</strong> your profile and fitness information at any time</li>
                <li><strong>Delete</strong> your account and all associated data by contacting us</li>
                <li><strong>Revoke</strong> HealthKit permissions through your device Settings</li>
                <li><strong>Opt out</strong> of push notifications through your device Settings</li>
            </ul>

            <h2>8. Data Retention</h2>
            <p>We retain your data for as long as your account is active. If you delete your account, we will remove your personal data within 30 days. Anonymized, aggregated data may be retained for analytics purposes.</p>

            <h2>9. Children's Privacy</h2>
            <p>GymJam is not intended for children under 17. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us and we will delete it.</p>

            <h2>10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date. Continued use of the app after changes constitutes acceptance of the revised policy.</p>

            <h2>11. Contact Us</h2>
            <p>If you have questions about this Privacy Policy or your data, contact us at:</p>
            <p><a href="mailto:privacy@gyymjaam.com">privacy@gyymjaam.com</a></p>
        </div>
    </div>
    <footer>
        &copy; 2026 GymJam. All rights reserved.
    </footer>
</body>
</html>`;
  }
}
