const antfu = require('@antfu/eslint-config')

module.exports = antfu.antfu(
    {
        rules: {
            'node/prefer-node-protocol': ['off'],
        },
        stylistic: {
            indent: 4,
            quotes: 'single',
            overrides: {
                'style/no-trailing-spaces': ['error', { ignoreComments: true }],
            },
        },
    },
    {
        files: ['**/*.{js,jsx,mjs,cjs}'],
    },
)
