const logger = require('../../utils/logger');
const winston = require('winston');

describe('Logger', () => {
  let consoleOutput = [];
  const originalConsole = console;

  beforeEach(() => {
    consoleOutput = [];
    console.log = jest.fn(msg => consoleOutput.push(msg));
    console.error = jest.fn(msg => consoleOutput.push(msg));
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
  });

  it('should create a logger instance', () => {
    expect(logger).toBeDefined();
    expect(logger).toHaveProperty('info');
    expect(logger).toHaveProperty('error');
    expect(logger).toHaveProperty('warn');
    expect(logger).toHaveProperty('debug');
  });

  it('should log info messages', () => {
    const testMessage = 'Test info message';
    logger.info(testMessage);
    
    expect(consoleOutput.length).toBeGreaterThan(0);
    expect(consoleOutput[0]).toContain(testMessage);
    expect(consoleOutput[0]).toContain('info');
  });

  it('should log error messages', () => {
    const testError = new Error('Test error message');
    logger.error(testError);
    
    expect(consoleOutput.length).toBeGreaterThan(0);
    expect(consoleOutput[0]).toContain(testError.message);
    expect(consoleOutput[0]).toContain('error');
  });

  it('should log with metadata', () => {
    const metadata = { userId: '123', action: 'test' };
    logger.info('Test message with metadata', metadata);
    
    expect(consoleOutput.length).toBeGreaterThan(0);
    expect(consoleOutput[0]).toContain('userId');
    expect(consoleOutput[0]).toContain('action');
  });

  it('should respect log levels', () => {
    const originalLevel = logger.level;
    logger.level = 'error';

    logger.debug('Debug message');
    logger.info('Info message');
    expect(consoleOutput.length).toBe(0);

    logger.error('Error message');
    expect(consoleOutput.length).toBeGreaterThan(0);

    logger.level = originalLevel;
  });

  it('should format timestamps correctly', () => {
    logger.info('Test timestamp');
    
    const logLine = consoleOutput[0];
    const timestampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    
    expect(logLine).toMatch(timestampRegex);
  });

  it('should handle objects in log messages', () => {
    const testObject = { key: 'value', nested: { prop: true } };
    logger.info('Test object', testObject);
    
    expect(consoleOutput.length).toBeGreaterThan(0);
    expect(consoleOutput[0]).toContain('key');
    expect(consoleOutput[0]).toContain('value');
    expect(consoleOutput[0]).toContain('nested');
  });
});
