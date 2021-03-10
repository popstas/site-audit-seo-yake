const { Readability } = require('@mozilla/readability');
const JSDOM = require('jsdom').JSDOM;
const createDOMPurify = require('dompurify');
const franc = require('franc');
const axios = require('axios');
const sw = require('stopword');
const convert3To1 = require('iso-639-3-to-1');

const config = {
  serverUrl: process.env.YAKE_SERVER_URL || 'http://localhost:5303/yake/',
  language: process.env.YAKE_DEFAULT_LANGUAGE || 'auto',
  maxNgramSize: process.env.YAKE_MAX_NGRAM_SIZE || 3,
  ngramThreshold: 0.02,
  numberKeywords: process.env.YAKE_NUMBER_KEYWORDS || 10,
};

const allowedLanguages = ['en', 'ru', 'fr'];
const skipArticleTags = ['script', 'style', 'noscript', /* 'head', 'header', 'footer', 'nav', 'aside' */];

// return readability article
function getArticle(result) {
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);
  const purifiedStr = DOMPurify.sanitize(result.content, {FORBID_TAGS: skipArticleTags});
  // console.log('purifiedStr: ', purifiedStr);
  const cleanDoc = new JSDOM(purifiedStr, {
    url: result.response.url,
  });
  const reader = new Readability(cleanDoc.window.document);
  const article = reader.parse();
  // console.log('article:', article);
  return article;
}

async function afterRequest(result, options) {
  const article = getArticle(result);
  let detectedLanguageIso639 = config.language

  try {
    if (article && detectedLanguageIso639 === 'auto') {
      const detectedLanguages = franc.all(article.textContent);
      // console.log('detectedLanguages: ', detectedLanguages);
      if (detectedLanguages.length > 0) {
        detectedLanguageIso639 = convert3To1(detectedLanguages[0][0]);
        result.yake_detectedLanguage = detectedLanguageIso639;
      }
    }
  } catch (e) {
    console.error('francErr:', e);
  }

  if (!allowedLanguages.includes(result.yake_detectedLanguage)) {
    console.log ('Language not supported: ' + result.yake_detectedLanguage);
    return;
  }

  try {
    if (article) {
      const cleanedArticleArr = sw.removeStopwords(article.textContent.split(' '), sw[detectedLanguageIso639]);

      let yakeResp;
      try {
        // console.log(`${detectedLanguageIso639} - ${result.response.url}`);
        yakeResp = await axios.post(config.serverUrl, {
          language: detectedLanguageIso639,
          max_ngram_size: config.maxNgramSize,
          number_of_keywords: config.numberKeywords,
          text: cleanedArticleArr.join(' '),
        });
      } catch (e) {
        console.error('Failed request to Yake: ' + e.response.data);
        if (e.response.data === 'Language not supported') {
          console.log('result.yake_detectedLanguage: ', result.yake_detectedLanguage);
        }
        // console.log(e);
        return;
      }

      if (!yakeResp) {
        console.error('Failed request to Yake');
        return;
      }

      const yakeKeywords = [];
      for (let key in yakeResp.data) {
        yakeKeywords.push(yakeResp.data[key]['ngram']); // score
      }
      result.yake_keywords = yakeKeywords.join(',<br>'); // yakeKeywords.toString();
    }

  } catch (e) {
    console.error('yakeError', e);
  }
  // console.log("result.yake_keywords: ", result.yake_keywords);
}


module.exports = afterRequest;
