import {
  Controller,
  Get,
  Post,
  Body,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

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

  @Get('terms')
  @Header('Content-Type', 'text/html')
  getTerms(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Use — GymJam</title>
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
                <a href="/terms">Terms of Use</a>
            </nav>
        </div>
    </header>
    <div class="container">
        <div class="hero">
            <h1>Terms of Use</h1>
            <p>Last updated: May 4, 2026</p>
        </div>
        <div class="content">
            <h2>1. Acceptance of Terms</h2>
            <p>By downloading, installing, or using the GymJam mobile application ("App"), you agree to be bound by these Terms of Use ("Terms"). If you do not agree to these Terms, do not use the App.</p>

            <h2>2. Description of Service</h2>
            <p>GymJam is a fitness application that provides workout tracking, AI-powered coaching, training plan generation, and a social community for fitness enthusiasts. The App is available on iOS devices.</p>

            <h2>3. Account Registration</h2>
            <p>To use GymJam, you must create an account using Apple Sign-In or Google Sign-In. You are responsible for maintaining the confidentiality of your account and for all activities that occur under your account. You must be at least 17 years old to use the App.</p>

            <h2>4. Subscriptions and Payments</h2>
            <p><strong>Free Tier:</strong> GymJam offers limited free access, including up to 20 AI coach messages and basic workout tracking.</p>
            <p><strong>Premium Subscription:</strong> Premium features include unlimited AI coaching, custom exercises, supersets, and AI training plan generation. Premium is available as:</p>
            <ul>
                <li>Monthly subscription</li>
                <li>3-Month subscription</li>
                <li>Annual subscription</li>
            </ul>
            <p><strong>Billing:</strong> Payment is charged to your Apple ID account at confirmation of purchase. Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current billing period. Your account will be charged for renewal within 24 hours prior to the end of the current period.</p>
            <p><strong>Cancellation:</strong> You can manage or cancel your subscription at any time through your device's Settings &gt; Apple ID &gt; Subscriptions. Cancellation takes effect at the end of the current billing period.</p>
            <p><strong>Free Trial:</strong> If offered, any unused portion of a free trial will be forfeited when you purchase a subscription.</p>

            <h2>5. User Content</h2>
            <p>You retain ownership of content you post to the GymJam community (posts, comments, photos). By posting content, you grant GymJam a non-exclusive, royalty-free license to display, distribute, and use your content within the App.</p>
            <p>You agree not to post content that:</p>
            <ul>
                <li>Is illegal, harmful, threatening, abusive, or harassing</li>
                <li>Infringes on intellectual property rights of others</li>
                <li>Contains spam, advertising, or promotional material</li>
                <li>Is sexually explicit or promotes violence</li>
                <li>Impersonates another person or entity</li>
            </ul>
            <p>We reserve the right to remove content that violates these Terms and to suspend or terminate accounts of repeat offenders.</p>

            <h2>6. AI Features Disclaimer</h2>
            <p>GymJam's AI coach and training plan features are for informational and motivational purposes only. They do not constitute medical, health, or fitness advice from a certified professional. Always consult a qualified healthcare provider or certified personal trainer before starting any new exercise program, especially if you have pre-existing health conditions or injuries.</p>
            <p>AI-generated recommendations may not be suitable for all individuals. You use AI features at your own risk.</p>

            <h2>7. Health and Safety</h2>
            <p>You acknowledge that physical exercise involves inherent risks of injury. You are solely responsible for your physical condition and for ensuring that any exercises you perform are appropriate for your fitness level. GymJam is not liable for any injuries sustained during workouts.</p>

            <h2>8. Intellectual Property</h2>
            <p>The GymJam app, including its design, features, code, and branding, is the property of GymJam and is protected by intellectual property laws. You may not copy, modify, distribute, or reverse-engineer any part of the App.</p>

            <h2>9. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul>
                <li>Use the App for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to the App or its systems</li>
                <li>Interfere with or disrupt the App's operation</li>
                <li>Use automated tools to scrape or collect data from the App</li>
                <li>Create multiple accounts to circumvent restrictions</li>
            </ul>

            <h2>10. Termination</h2>
            <p>We may suspend or terminate your account at any time for violation of these Terms, without prior notice. Upon termination, your right to use the App ceases immediately.</p>

            <h2>11. Disclaimer of Warranties</h2>
            <p>The App is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not guarantee that the App will be uninterrupted, error-free, or free of harmful components.</p>

            <h2>12. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, GymJam shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the App, including but not limited to physical injury, data loss, or loss of profits.</p>

            <h2>13. Changes to Terms</h2>
            <p>We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the revised Terms.</p>

            <h2>14. Contact Us</h2>
            <p>If you have questions about these Terms, contact us at:</p>
            <p><a href="mailto:support@gyymjaam.com">support@gyymjaam.com</a></p>
        </div>
    </div>
    <footer>&copy; 2026 GymJam. All rights reserved.</footer>
</body>
</html>`;
  }

  @Get('support')
  @Header('Content-Type', 'text/html')
  getSupport(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Support — GymJam</title>
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
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 6px; }
        .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 12px 16px; border: 1px solid #ddd; border-radius: 12px; font-size: 15px; font-family: inherit; color: #1a1a2e; background: #F8F9FA; transition: border-color 0.2s; }
        .form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: #E86A75; background: #fff; }
        .form-group textarea { min-height: 150px; resize: vertical; }
        .submit-btn { width: 100%; padding: 14px; background: #E86A75; color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; transition: background 0.2s; }
        .submit-btn:hover { background: #d55d68; }
        .submit-btn:disabled { background: #ccc; cursor: not-allowed; }
        .success-msg { text-align: center; padding: 40px 0; }
        .success-msg h2 { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #30C08D; }
        .success-msg p { color: #666; font-size: 15px; }
        .error-msg { color: #E86A75; font-size: 14px; margin-top: 8px; display: none; }
        footer { text-align: center; padding: 32px 0; border-top: 1px solid #eee; color: #999; font-size: 13px; }
        @media (max-width: 600px) { .hero h1 { font-size: 28px; } .content { padding: 28px 20px; } }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <a href="https://gyymjaam.com" class="logo">Gym<span>Jam</span></a>
            <nav>
                <a href="/privacy">Privacy Policy</a>
                <a href="/support">Support</a>
            </nav>
        </div>
    </header>
    <div class="container">
        <div class="hero">
            <h1>Contact Support</h1>
            <p>We're here to help. Send us a message and we'll get back to you.</p>
        </div>
        <div class="content">
            <form id="supportForm">
                <div class="form-group">
                    <label for="name">Your Name</label>
                    <input type="text" id="name" name="name" required placeholder="John Doe">
                </div>
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input type="email" id="email" name="email" required placeholder="john@example.com">
                </div>
                <div class="form-group">
                    <label for="category">Category</label>
                    <select id="category" name="category">
                        <option value="general">General Question</option>
                        <option value="bug">Bug Report</option>
                        <option value="account">Account Issue</option>
                        <option value="subscription">Subscription</option>
                        <option value="feedback">Feedback</option>
                        <option value="data">Data / Privacy Request</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="message">Message</label>
                    <textarea id="message" name="message" required placeholder="Describe your issue or question..."></textarea>
                </div>
                <p class="error-msg" id="errorMsg"></p>
                <button type="submit" class="submit-btn" id="submitBtn">Send Message</button>
            </form>
            <div class="success-msg" id="successMsg" style="display:none;">
                <h2>Message Sent!</h2>
                <p>Thank you for reaching out. We'll get back to you as soon as possible.</p>
            </div>
        </div>
    </div>
    <footer>&copy; 2026 GymJam. All rights reserved.</footer>
    <script>
        document.getElementById('supportForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            const errEl = document.getElementById('errorMsg');
            btn.disabled = true;
            btn.textContent = 'Sending...';
            errEl.style.display = 'none';
            try {
                const res = await fetch('/support', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: document.getElementById('name').value,
                        email: document.getElementById('email').value,
                        category: document.getElementById('category').value,
                        message: document.getElementById('message').value,
                    }),
                });
                if (!res.ok) throw new Error('Failed to send');
                document.getElementById('supportForm').style.display = 'none';
                document.getElementById('successMsg').style.display = 'block';
            } catch {
                errEl.textContent = 'Something went wrong. Please try again.';
                errEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Send Message';
            }
        });
    </script>
</body>
</html>`;
  }

  @Post('support')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async submitSupport(
    @Body()
    body: {
      name: string;
      email: string;
      category: string;
      message: string;
    },
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO support_requests (id, name, email, category, message, created_at)
      VALUES (gen_random_uuid(), ${body.name}, ${body.email}, ${body.category}, ${body.message}, NOW())
    `;
    return { success: true };
  }
}
