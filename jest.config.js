module.exports = {
    testPathIgnorePatterns: [
        "/node_modules/",
        "/frontend/"
    ],
    transform: {
        "^.+\\.js$": "babel-jest",
    },
};
