require('dotenv').config();
const path = require("path");

module.exports = {
  development: {
    dialect: "sqlite",
    storage: path.join(__dirname, "../database/database.sqlite"),
    logging: false
  },

  production: {
    dialect: "sqlite",
    storage: path.join(__dirname, "../database/database.sqlite"),
    logging: false
  }
};