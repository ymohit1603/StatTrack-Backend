const express = require('express');
const router = express.Router();

const logger = require('../utils/logger');

router.post('/', async (req, res, next) => {
  console.log(req,req.body);
  return;
});

router.get('/',async (req,res,next)=>{
  console.log("HEllo world");
  return res.json({message:"Hello"});
})

module.exports = router; 