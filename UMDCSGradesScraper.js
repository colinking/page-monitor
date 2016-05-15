const Scraper = require('./Scraper');
const async = require('async');
const cheerio = require('cheerio');
const tidy = require('htmltidy').tidy;

// Class to scrape the UMD CS grades page:
// https://grades.cs.umd.edu
class UMDCSGradesScraper extends Scraper {

  // Login to the UMD CS grade server
  login(callback) {
    const umdLogin = UMDCSGradesScraper.getUMDLogin();
    this.agent
      .post(UMDCSGradesScraper.urls.login)
      .send({
        user: umdLogin.id,
        password: umdLogin.password,
        submit: 'Login',
      })
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .end(callback);
  }

  // Fetch and return the new data
  getData(callback) {
    // Get agent from login
    this.login((err, resp) => {
      if (err) {
        callback(err);
      } else {
        const $ = cheerio.load(resp.text);

        // Get a list of classes and their URLs
        const classes = [];
        $('tr:nth-child(3) table:nth-child(2) td a').each((i, elem) => {
          classes.push({
            className: $(elem).text(),
            url: UMDCSGradesScraper.urls.classPage + $(elem).attr('href'),
          });
        });

        // for each class, get data from it's page
        async.mapSeries(classes, ({ className, url }, callback) => {
          this.agent
            .get(url)
            .end((err, resp) => {
              if (err) {
                callback(err);
              } else {
                // The UMD CS grade server has REALLY bad HTML
                tidy(resp.text, (err, html) => {
                  // Find each assignment from the grades table
                  const $ = cheerio.load(html);
                  const grades = [];
                  let finalPercent = undefined;
                  $($($('table').get(2)).find('tr')).each((i, elem) => {
                    if (i !== 0) {
                      const grade = {};
                      grade.title = $($(elem).find('td').get(0)).text();
                      grade.score = $($(elem).find('td').get(1)).text();
                      grade.maxscore = $($(elem).find('td').get(2)).text();
                      grade.comment = $($(elem).find('td').get(4)).text();
                      if (grade.title === 'Total') {
                        finalPercent = grade.score;
                      } else {
                        grades.push(grade);
                      }
                    }
                  });

                  // Find the final grade, if it exists
                  let finalLetter = undefined;
                  $('p').each((i, elem) => {
                    const text = $(elem).text();
                    const matches = text.match('Your final grade in the class is a (.*)');
                    if (matches.length > 1) {
                      finalLetter = matches[1];
                    }
                  });

                  callback(null, { className, grades, finalLetter, finalPercent });
                });
              }
            });
        }, (err, results) => {
          // Convert to a hashtable
          const newData = {};
          async.eachSeries(results, (result, cb) => {
            newData[result.className] = result;
            cb();
          });
          callback(err, newData);
        });
      }
    });
  }

  // Check if the data scraped from the CS grade server has changed
  // Format the changes with messages to be sent in a notification
  diff(oldData, newData) {
    const changes = {};
    async.each(Object.keys(newData), (className) => {
      const classChanges = [];
      const oldClassData = oldData[className] ? oldData[className] : {};
      const newClassData = newData[className] ? newData[className] : {};
      // Check if the final grade changed
      if (newClassData.finalLetter && !oldClassData.finalLetter ||
        newClassData.finalLetter !== oldClassData.finalLetter) {
        const oldLetterGrade = oldClassData.finalLetter ? oldClassData.finalLetter : 'N/A';
        const newLetterGrade = newClassData.finalLetter ? newClassData.finalLetter : 'N/A';
        classChanges.push(
          `Your final grade has changed from "${oldLetterGrade}" to "${newLetterGrade}".`);
      }

      // Check if the final percent changed
      if (newClassData.finalPercent && !oldClassData.finalPercent ||
        newClassData.finalPercent !== oldClassData.finalPercent) {
        const oldPercent = oldClassData.finalPercent ? oldClassData.finalPercent : 'N/A';
        const newPercent = newClassData.finalPercent ? newClassData.finalPercent : 'N/A';
        classChanges.push(`Your total grade has changed from ${oldPercent}% to ${newPercent}%.`);
      }

      let i = 0;
      while (i < newClassData.grades.length) {
        const newGrade = newClassData.grades[i];
        if (oldClassData.grades && i < oldClassData.grades.length) {
          const oldGrade = oldClassData.grades[i];
          if (oldGrade.title !== newGrade.title ||
            oldGrade.score !== newGrade.score ||
            oldGrade.maxscore !== newGrade.maxscore) {
            classChanges.push(
              `${oldGrade.title} ${oldGrade.score}/${oldGrade.maxscore} =>
${newGrade.title} ${newGrade.score}/${newGrade.maxscore}`);
          }
        } else {
          classChanges.push(`New: ${newGrade.title} ${newGrade.score}/${newGrade.maxscore}`);
        }
        i++;
      }

      changes[className] = classChanges;
    });

    return changes;
  }
}

UMDCSGradesScraper.name = 'UMD CS Grades';
UMDCSGradesScraper.urls = {
  login: 'https://grades.cs.umd.edu/classWeb/login.cgi',
  classPage: 'https://grades.cs.umd.edu/classWeb/',
};

module.exports = UMDCSGradesScraper;