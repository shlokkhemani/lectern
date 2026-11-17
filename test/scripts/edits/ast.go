// A call: the function, then its arguments.
type CallExpression struct {
	Token     token.Token
	Function  Expression
	Arguments []Expression
}
