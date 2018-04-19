//===========================index.js==========================//
//                                                             //
//  Author:    Michael A Liddle                                //
//  Email:     mike@mikeliddle.com                             //
//  Website:   http://www.mikeliddle.com                       //
//                                                             //
//  The copyright to the source code and computer program(s)   //
//  herein is the property of Mike Liddle.The source code      //
//  and program(s) may be used and/or copied only with the     //
//  written permission of Mike Liddle or in accordance with    //
//  the terms and conditions stipulated in the                 //
//  agreement/contract under which the source code and         //
//  program(s) have been supplied.                             //
//                                                             //
'use strict';

const alexaSDK = require('alexa-sdk');
const awsSDK = require('aws-sdk');
const promisify = require('es6-promisify');

const APP_ID = '';
const MessagesTable = '';
const docClient = new awsSDK.DynamoDB.DocumentClient();

const EXPIRE_PERIOD = 1209600000;

// convert callback style functions to promises
const dbScan = promisify(docClient.scan, docClient);
const dbGet = promisify(docClient.get, docClient);
const dbPut = promisify(docClient.put, docClient);
const dbDelete = promisify(docClient.delete, docClient);

const instructions = `Welcome to Memo<break strength="medium" />
                      The following commands are available: leave a message, check my messages,
                      delete my messages.  What would you like to do?`;

const handlers = {

  /**
   * Triggered when the user says "Alexa, open Memo."
   */
  'LaunchRequest'() {
    this.emit(':ask', instructions);
  },

  /**
   * Adds a Message to the current user's saved Messages.
   * Slots: MessageTo, content
   */
  'AddMessageIntent'() {
    const { userId } = this.event.session.user;
    const { slots } = this.event.request.intent;

    // prompt for slot values and request a confirmation for each

    // MessageTo
    if (!slots.MessageTo.value) {
      const slotToElicit = 'MessageTo';
      const speechOutput = 'Who is this message for?';
      const repromptSpeech = 'Please tell me the name of the person the Message is for';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    } else if (slots.MessageTo.confirmationStatus !== 'CONFIRMED') {

      if (slots.MessageTo.confirmationStatus !== 'DENIED') {
        // slot status: unconfirmed
        const slotToConfirm = 'MessageTo';
        const speechOutput = `You would like to leave a message for ${slots.MessageTo.value}, correct?`;
        const repromptSpeech = speechOutput;
        return this.emit(':confirmSlot', slotToConfirm, speechOutput, repromptSpeech);
      }

      // slot status: denied -> reprompt for slot data
      const slotToElicit = 'MessageTo';
      const speechOutput = 'Who is this message for?';
      const repromptSpeech = 'Please tell me the name of the person the Message is for';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }

    if (!slots.content.value) {
      const slotToElicit = 'content';
      const speechOutput = 'What would you like to say?';
      const repromptSpeech = 'Please tell me the message you would like to leave.';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    } else if (slots.content.confirmationStatus !== 'CONFIRMED') {

      if (slots.content.confirmationStatus !== 'DENIED') {
        // slot status: unconfirmed
        const slotToConfirm = 'content';
        const speechOutput = `Your message to ${slots.MessageTo.value} is, ${slots.content.value}, correct?`;
        const repromptSpeech = `You would like to say ${slots.content.value}, correct?`;
        return this.emit(':confirmSlot', slotToConfirm, speechOutput, repromptSpeech);
      }

      // slot status: denied -> reprompt for slot data
      const slotToElicit = 'content';
      const speechOutput = 'What would you like to say?';
      const repromptSpeech = 'Please tell me the message you would like to leave.';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }

    // all slot values received and confirmed, now add the record to DynamoDB

    const messageTo = slots.MessageTo.value;
    const content = slots.content.value;
    
    var expireTime = new Date();
    expireTime.setTime(expireTime.getTime() + EXPIRE_PERIOD);


    const dynamoParams = {
      TableName: MessagesTable,
      Item: {
        UserId: userId,
        MessageTo: messageTo,
        Content: content,
        expires: Math.floor(expireTime.getTime() / 1000)
      }
    };

    console.log('Attempting to add Message', dynamoParams);

    dbPut(dynamoParams)
    .then(data => {
        console.log('Add item succeeded', data);
        this.emit(':tell', `Message added!`);
      })
      .catch(err => {
        this.emit(':tell', `An unexpected error occured!`);
        console.error(err);
      });
  },

  /**
   * Lists all saved Messages for the current user. The user can filter by quick or long Messages.
   * Slots: GetMessageQuickOrLong
   */
  'GetAllMessagesIntent'() {
    const { userId } = this.event.session.user;
    const { slots } = this.event.request.intent;
    let output;

    const dynamoParams = {
      TableName: MessagesTable
    };

    // MessageTo
    if (!slots.MessageTo.value) {
      const slotToElicit = 'MessageTo';
      const speechOutput = 'Who do you want to hear messages for?';
      const repromptSpeech = 'Please tell me who you are.';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }

    dynamoParams.FilterExpression = 'UserId = :user_id AND MessageTo = :message_to';
    dynamoParams.ExpressionAttributeValues = { ':user_id': userId, ':message_to': slots.MessageTo.value };
    output = `The following Messages were found for ${slots.MessageTo.value}: <break strength="x-strong" />`;

    // query DynamoDB
    dbScan(dynamoParams)
      .then(data => {
        console.log('Read table succeeded!', data);

        if (data.Items && data.Items.length) {
          data.Items.forEach(item => { output += `${item.Content}<break strength="strong" />\n`; });
        }
        else {
          output = `No Messages were found for ${slots.MessageTo.value}!`;
        }

        console.log('output', output);

        this.emit(':tell', output);
      })
      .catch(err => {
        console.error(err);
        this.emit(':tell', `An unexpected error occured!`);
      });

  },

  'DeleteMessageIntent'() {
    const { slots } = this.event.request.intent;

    // prompt for the recipe name if needed and then require a confirmation
    if (!slots.MessageTo.value) {
      const slotToElicit = 'MessageTo';
      const speechOutput = 'Would you like to delete your messages?';
      const repromptSpeech = 'Would you like to clear all messages?';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }
    else if (slots.MessageTo.confirmationStatus !== 'CONFIRMED') {

      if (slots.MessageTo.confirmationStatus !== 'DENIED') {
        // slot status: unconfirmed
        const slotToConfirm = 'MessageTo';
        const speechOutput = `You would like to delete all messages for ${slots.MessageTo.value}, correct?`;
        const repromptSpeech = speechOutput;
        return this.emit(':confirmSlot', slotToConfirm, speechOutput, repromptSpeech);
      }

      // slot status: denied -> reprompt for slot data
      const slotToElicit = 'MessageTo';
      const speechOutput = 'Ok!';
      return this.emit(':tell', speechOutput);
    }

    const { userId } = this.event.session.user;
    const messageTo = slots.MessageTo.value;
    const dynamoParams = {
      TableName: MessagesTable
    };

    const deleteParams = {
      TableName: MessagesTable,
      Key: {
        UserId: userId,
        MessageTo: slots.MessageTo.value
      }
    };

    console.log('Attempting to read data');

    dynamoParams.FilterExpression = 'UserId = :user_id AND MessageTo = :message_to';
    dynamoParams.ExpressionAttributeValues = { ':user_id': userId, ':message_to': slots.MessageTo.value };

    deleteParams.ConditionExpression = dynamoParams.FilterExpression;
    deleteParams.ExpressionAttributeValues = dynamoParams.ExpressionAttributeValues;

    // query DynamoDB
    dbScan(dynamoParams)
      .then(data => {
        console.log('Read table succeeded!', data);

        var output = "";

        if (data.Items && data.Items.length) {
          dbDelete(deleteParams).then(data => {
              output = "Successfully deleted all messages!";
              this.emit(':tell', output);
          }).catch(err => {
              output = "An error occured while deleting all messages!  Please try again later.";
              this.emit(':tell', output);
          });

        }
        else {
          output = 'No Messages found!';
          this.emit(':tell', output);
        }
      })
      .catch(err => {
        console.error(err);
        this.emit(':tell', `An unexpected error occured!`);
      });
  },

  'Unhandled'() {
    console.error('problem', this.event);
    this.emit(':ask', 'An error occurred!');
  },

  'AMAZON.HelpIntent'() {
    const speechOutput = instructions;
    const reprompt = instructions;
    this.emit(':ask', speechOutput, reprompt);
  },

  'AMAZON.CancelIntent'() {
    this.emit(':tell', 'Goodbye!');
  },

  'AMAZON.StopIntent'() {
    this.emit(':tell', 'Goodbye!');
  }
};

exports.handler = function handler(event, context) {
  const alexa = alexaSDK.handler(event, context);
  alexa.appId = APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};
