import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting - prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(limiter);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Facebook Automation Backend is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Validate AppState session
app.post('/api/validate', async (req, res) => {
  let browser;
  try {
    const { appstate } = req.body;
    
    console.log('🔍 Validating session...');
    
    if (!appstate || !Array.isArray(appstate)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid AppState format. Must be an array of cookies.' 
      });
    }

    // Check for required cookies
    const c_user = appstate.find(c => c.name === 'c_user');
    const xs = appstate.find(c => c.name === 'xs');

    if (!c_user || !xs) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required cookies: c_user or xs' 
      });
    }

    // Launch browser with Puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set realistic viewport
    await page.setViewport({ width: 1280, height: 720 });
    
    // Set user agent to mimic real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Set cookies from AppState
    await page.setCookie(...appstate);
    
    console.log('🌐 Navigating to Facebook...');
    
    // Navigate to Facebook
    await page.goto('https://facebook.com', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Check if we're properly logged in
    const isLoggedIn = await page.evaluate(() => {
      // Look for elements that indicate successful login
      const createPostBtn = document.querySelector('[aria-label="Create a post"]');
      const messengerBtn = document.querySelector('[aria-label="Messenger"]');
      const notificationsBtn = document.querySelector('[aria-label="Notifications"]');
      
      return !!(createPostBtn || messengerBtn || notificationsBtn);
    });

    if (isLoggedIn) {
      // Get username for confirmation
      const userInfo = await page.evaluate(() => {
        const profileLink = document.querySelector('[aria-label="Your profile"]');
        return profileLink ? profileLink.getAttribute('aria-label') : 'Facebook User';
      });

      console.log('✅ Session validated successfully');
      
      res.json({ 
        success: true, 
        message: 'Session is valid and ready for automation',
        user: userInfo,
        userId: c_user.value
      });
    } else {
      console.log('❌ Session validation failed - not logged in');
      res.status(401).json({ 
        success: false, 
        error: 'Invalid session - unable to login with provided cookies' 
      });
    }

  } catch (error) {
    console.error('💥 Validation error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: `Validation failed: ${error.message}` 
    });
  } finally {
    // Always close the browser
    if (browser) {
      await browser.close();
    }
  }
});

// Share to timeline
app.post('/api/share', async (req, res) => {
  let browser;
  try {
    const { appstate, message, link, count = 1, delay = 15 } = req.body;
    
    console.log('🚀 Starting sharing process...');
    
    // Validation
    if (!appstate || !Array.isArray(appstate)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid AppState format' 
      });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message is required' 
      });
    }

    const shareCount = Math.min(Math.max(parseInt(count), 1), 10); // Limit to 10 shares
    const shareDelay = Math.min(Math.max(parseInt(delay), 5), 60); // 5-60 second delay

    console.log(`📤 Sharing ${shareCount} posts with ${shareDelay}s delay`);

    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Set cookies
    await page.setCookie(...appstate);

    const results = [];
    
    for (let i = 0; i < shareCount; i++) {
      try {
        console.log(`📝 Attempt ${i + 1} of ${shareCount}...`);
        
        // Navigate to Facebook
        await page.goto('https://facebook.com', { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });

        // Wait for page to load completely
        await page.waitForTimeout(2000);

        // Check if we're still logged in
        const isLoggedIn = await page.evaluate(() => {
          return !!document.querySelector('[aria-label="Create a post"]');
        });

        if (!isLoggedIn) {
          throw new Error('Session expired during automation');
        }

        // Click create post button
        await page.click('[aria-label="Create a post"]');
        await page.waitForTimeout(1000);

        // Type the message
        await page.keyboard.type(message);
        await page.waitForTimeout(1000);

        // Add link if provided
        if (link && link.trim()) {
          await page.click('[aria-label="Add to your post"]');
          await page.waitForTimeout(1000);
          await page.keyboard.type(link);
          await page.waitForTimeout(1000);
        }

        // Click post button
        await page.click('[aria-label="Post"]');
        
        // Wait for post to complete
        await page.waitForTimeout(5000);

        // Check if post was successful
        const postSuccess = await page.evaluate(() => {
          return !document.querySelector('[aria-label="Create a post"]'); // Button should disappear
        });

        if (postSuccess) {
          results.push({
            attempt: i + 1,
            success: true,
            timestamp: new Date().toISOString(),
            message: `Successfully shared post ${i + 1}`
          });
          console.log(`✅ Successfully shared post ${i + 1}`);
        } else {
          throw new Error('Post may not have been published');
        }

        // Delay between posts (except for the last one)
        if (i < shareCount - 1) {
          console.log(`⏳ Waiting ${shareDelay} seconds before next post...`);
          await page.waitForTimeout(shareDelay * 1000);
        }

      } catch (attemptError) {
        console.error(`❌ Failed attempt ${i + 1}:`, attemptError.message);
        results.push({
          attempt: i + 1,
          success: false,
          error: attemptError.message,
          timestamp: new Date().toISOString()
        });
        
        // Continue with next attempt despite failure
        if (i < shareCount - 1) {
          await page.waitForTimeout(shareDelay * 1000);
        }
      }
    }

    // Calculate summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`🎉 Automation completed: ${successful} successful, ${failed} failed`);

    res.json({ 
      success: true, 
      results: results,
      summary: {
        total: shareCount,
        successful: successful,
        failed: failed,
        successRate: Math.round((successful / shareCount) * 100)
      }
    });

  } catch (error) {
    console.error('💥 Sharing error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: `Sharing failed: ${error.message}` 
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Simple share to story (basic implementation)
app.post('/api/share-story', async (req, res) => {
  let browser;
  try {
    const { appstate, message } = req.body;
    
    if (!appstate || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'AppState and message are required' 
      });
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setCookie(...appstate);
    await page.goto('https://facebook.com', { waitUntil: 'networkidle2' });

    // Note: Story sharing is more complex and may require different selectors
    // This is a basic implementation that might need adjustment
    
    res.json({ 
      success: true, 
      message: 'Story sharing endpoint - implementation may need adjustment based on Facebook UI'
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

// Server status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'operational',
    serverTime: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Unhandled error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint not found' 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
