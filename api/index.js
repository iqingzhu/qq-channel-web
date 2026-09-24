const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 获取QQ AccessToken
async function getQQToken(appId, appSecret) {
  const resp = await fetch('https://api.bot.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: appSecret })
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('获取token失败: ' + JSON.stringify(data));
  return data.access_token;
}

// 获取子频道列表
app.post('/api/get-channels', async (req, res) => {
  try {
    const { appId, appSecret, guildId } = req.body;
    const token = await getQQToken(appId, appSecret);
    const resp = await fetch(`https://api.sgroup.qq.com/guilds/${guildId}/channels`, {
      headers: { 'Authorization': `QQBot ${token}` }
    });
    const data = await resp.json();
    res.json({ success: true, channels: data || [] });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 拉取帖子
app.post('/api/fetch-posts', async (req, res) => {
  try {
    const { appId, appSecret, channelIds, guildUrl } = req.body;
    const token = await getQQToken(appId, appSecret);
    const allPosts = [];

    for (const channelId of channelIds) {
      let beforeThreadId = null;
      let hasMore = true;
      let page = 1;
      while (hasMore && page <= 50) {
        let url = `https://api.sgroup.qq.com/channels/${channelId}/threads?limit=100`;
        if (beforeThreadId) url += `&before=${encodeURIComponent(beforeThreadId)}`;
        const resp = await fetch(url, { headers: { 'Authorization': `QQBot ${token}` } });
        const data = await resp.json();
        if (data.threads && data.threads.length > 0) {
          data.threads.forEach(thread => {
            const ti = thread.thread_info || thread;
            const rawContent = ti.content || '';
            let plainContent = rawContent;
            let images = [];
            try {
              const contentObj = JSON.parse(rawContent);
              if (contentObj.paragraphs) {
                plainContent = contentObj.paragraphs.map(p => {
                  if (!p.elems) return '';
                  return p.elems.map(e => {
                    if (e.text?.text) return e.text.text;
                    if (e.image?.plat_image?.url) {
                      images.push(e.image.plat_image.url);
                      return `<img src="${e.image.plat_image.url}" style="max-width:100%;margin:10px 0;">`;
                    }
                    return '';
                  }).join('');
                }).join('\n\n');
              }
            } catch (e) {}

            allPosts.push({
              thread_id: ti.thread_id,
              title: ti.title || '',
              content: plainContent,
              images,
              publish_time: ti.publish_time || ti.create_time,
              author: '频道成员',
              url: guildUrl + '/post/' + ti.thread_id
            });
          });
          beforeThreadId = data.threads[data.threads.length - 1].thread_id;
          if (data.threads.length < 100) hasMore = false;
          page++;
        } else {
          hasMore = false;
        }
      }
    }

    res.json({ success: true, posts: allPosts });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 获取WordPress分类
app.post('/api/get-wp-categories', async (req, res) => {
  try {
    const { wpUrl, wpUser, wpPass } = req.body;
    const auth = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
    const resp = await fetch(`${wpUrl}/wp-json/wp/v2/categories?per_page=100`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    const data = await resp.json();
    res.json({ success: true, categories: data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 发布到WordPress
app.post('/api/publish-posts', async (req, res) => {
  try {
    const { wpUrl, wpUser, wpPass, posts, categoryIds } = req.body;
    const auth = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
    const results = [];
    for (const post of posts) {
      const body = {
        title: post.title,
        content: post.content,
        status: 'publish',
        categories: categoryIds
      };
      const resp = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      results.push({ thread_id: post.thread_id, success: resp.ok, id: data.id });
    }
    res.json({ success: true, results });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = app;
